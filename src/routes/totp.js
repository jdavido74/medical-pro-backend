/**
 * TOTP (2FA) Routes
 *
 * Endpoints for managing Two-Factor Authentication
 */

const express = require('express');
const router = express.Router();
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { authMiddleware } = require('../middleware/auth');
const totpService = require('../services/totpService');
const { getCentralDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');

// Aggressive rate limiter for 2FA validation (unauthenticated endpoint)
// 5 attempts per 15 minutes per IP to prevent brute force of 6-digit codes
const twoFaValidateLimiter = new RateLimiterMemory({
  keyPrefix: '2fa_validate',
  points: 5,
  duration: 15 * 60,
  blockDuration: 15 * 60
});

// Middleware to require super_admin role
const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Super admin privileges required.'
    });
  }
  next();
};

// Encryption key for TOTP secrets (should be in environment)
const ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET;

/**
 * GET /api/v1/auth/2fa/status
 * Get 2FA status for current user
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const centralDb = getCentralDbConnection();
    const [userRows] = await centralDb.query(
      'SELECT totp_enabled, totp_enabled_at FROM users WHERE id = $1',
      { bind: [req.user.userId] }
    );
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        enabled: user.totp_enabled || false,
        enabledAt: user.totp_enabled_at
      }
    });
  } catch (error) {
    logger.error('Error getting 2FA status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get 2FA status'
    });
  }
});

/**
 * POST /api/v1/auth/2fa/setup
 * Initialize 2FA setup - generates secret and returns QR code data
 * Only for super_admin users
 */
router.post('/setup', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const centralDb = getCentralDbConnection();

    // Check if 2FA is already enabled
    const [userRows] = await centralDb.query(
      'SELECT email, totp_enabled FROM users WHERE id = $1',
      { bind: [req.user.userId] }
    );
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (user.totp_enabled) {
      return res.status(400).json({
        success: false,
        error: '2FA is already enabled. Disable it first to reconfigure.'
      });
    }

    // Generate new secret
    const secret = totpService.generateSecret();
    const otpauthUri = totpService.generateOTPAuthURI(secret, user.email);

    // Store encrypted secret temporarily (not enabled yet)
    const encryptedSecret = totpService.encryptSecret(secret, ENCRYPTION_KEY);

    await centralDb.query(
      'UPDATE users SET totp_secret = $1, updated_at = NOW() WHERE id = $2',
      { bind: [encryptedSecret, req.user.userId] }
    );

    logger.info(`2FA setup initiated for user ${req.user.userId}`);

    res.json({
      success: true,
      data: {
        secret: secret, // Show to user for manual entry
        otpauthUri: otpauthUri, // For QR code generation
        message: 'Scan the QR code with your authenticator app, then verify with a code'
      }
    });
  } catch (error) {
    logger.error('Error setting up 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to setup 2FA'
    });
  }
});

/**
 * POST /api/v1/auth/2fa/verify-setup
 * Verify the TOTP code and enable 2FA
 */
router.post('/verify-setup', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || code.length !== 6) {
      return res.status(400).json({
        success: false,
        error: 'Invalid code format. Please enter a 6-digit code.'
      });
    }

    const centralDb = getCentralDbConnection();

    // Get user's pending secret
    const [userRows] = await centralDb.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1',
      { bind: [req.user.userId] }
    );
    const user = userRows[0];

    if (!user || !user.totp_secret) {
      return res.status(400).json({
        success: false,
        error: 'No 2FA setup in progress. Please start setup first.'
      });
    }

    if (user.totp_enabled) {
      return res.status(400).json({
        success: false,
        error: '2FA is already enabled.'
      });
    }

    // Decrypt and verify
    const secret = totpService.decryptSecret(user.totp_secret, ENCRYPTION_KEY);
    const isValid = totpService.verifyTOTP(secret, code);

    if (!isValid) {
      logger.warn(`Invalid 2FA verification code for user ${req.user.userId}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid code. Please try again with a new code from your authenticator.'
      });
    }

    // Generate backup codes
    const backupCodes = totpService.generateBackupCodes(10);
    const hashedBackupCodes = backupCodes.map(code => totpService.hashBackupCode(code));

    // Enable 2FA
    await centralDb.query(
      `UPDATE users SET
        totp_enabled = true,
        totp_backup_codes = $1,
        totp_enabled_at = NOW(),
        updated_at = NOW()
       WHERE id = $2`,
      { bind: [hashedBackupCodes, req.user.userId] }
    );

    logger.info(`2FA enabled for user ${req.user.userId}`);

    res.json({
      success: true,
      data: {
        message: '2FA has been enabled successfully',
        backupCodes: backupCodes // Show once, user must save these
      }
    });
  } catch (error) {
    logger.error('Error verifying 2FA setup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify 2FA setup'
    });
  }
});

/**
 * POST /api/v1/auth/2fa/validate
 * Validate a TOTP code during login
 * Called after successful password authentication
 *
 * Rate limited: 5 attempts per 15 minutes per IP
 */
router.post('/validate', async (req, res) => {
  try {
    // Rate limit by IP to prevent brute force
    try {
      await twoFaValidateLimiter.consume(req.ip || req.connection.remoteAddress);
    } catch (rateLimitError) {
      logger.warn(`2FA validate rate limit exceeded for IP: ${req.ip}`);
      return res.status(429).json({
        success: false,
        error: 'Too many attempts. Please try again later.'
      });
    }

    const { userId, code } = req.body;

    if (!userId || !code) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId or code'
      });
    }

    const centralDb = getCentralDbConnection();

    const [userRows] = await centralDb.query(
      'SELECT totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id = $1',
      { bind: [userId] }
    );
    const user = userRows[0];

    if (!user || !user.totp_enabled || !user.totp_secret) {
      return res.status(400).json({
        success: false,
        error: '2FA is not enabled for this user'
      });
    }

    // Try TOTP code first
    const secret = totpService.decryptSecret(user.totp_secret, ENCRYPTION_KEY);
    let isValid = totpService.verifyTOTP(secret, code);
    let usedBackupCode = false;

    // If TOTP fails, try backup code
    if (!isValid && user.totp_backup_codes && user.totp_backup_codes.length > 0) {
      const backupIndex = totpService.verifyBackupCode(code, user.totp_backup_codes);
      if (backupIndex !== -1) {
        isValid = true;
        usedBackupCode = true;

        // Remove used backup code
        const remainingCodes = [...user.totp_backup_codes];
        remainingCodes.splice(backupIndex, 1);

        await centralDb.query(
          'UPDATE users SET totp_backup_codes = $1, updated_at = NOW() WHERE id = $2',
          { bind: [remainingCodes, userId] }
        );

        logger.warn(`Backup code used for user ${userId}. ${remainingCodes.length} codes remaining.`);
      }
    }

    if (!isValid) {
      logger.warn(`Invalid 2FA code for user ${userId}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication code'
      });
    }

    logger.info(`2FA validated for user ${userId}${usedBackupCode ? ' (backup code)' : ''}`);

    res.json({
      success: true,
      data: {
        validated: true,
        usedBackupCode,
        remainingBackupCodes: usedBackupCode ? user.totp_backup_codes.length - 1 : undefined
      }
    });
  } catch (error) {
    logger.error('Error validating 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate 2FA'
    });
  }
});

/**
 * POST /api/v1/auth/2fa/disable
 * Disable 2FA for current user
 */
router.post('/disable', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { code, password } = req.body;

    if (!code || !password) {
      return res.status(400).json({
        success: false,
        error: 'Code and password are required to disable 2FA'
      });
    }

    const centralDb = getCentralDbConnection();
    const bcrypt = require('bcryptjs');

    // Get user
    const [userRows] = await centralDb.query(
      'SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = $1',
      { bind: [req.user.userId] }
    );
    const user = userRows[0];

    if (!user || !user.totp_enabled) {
      return res.status(400).json({
        success: false,
        error: '2FA is not enabled'
      });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid password'
      });
    }

    // Verify TOTP code
    const secret = totpService.decryptSecret(user.totp_secret, ENCRYPTION_KEY);
    const codeValid = totpService.verifyTOTP(secret, code);

    if (!codeValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication code'
      });
    }

    // Disable 2FA
    await centralDb.query(
      `UPDATE users SET
        totp_enabled = false,
        totp_secret = NULL,
        totp_backup_codes = NULL,
        totp_enabled_at = NULL,
        updated_at = NOW()
       WHERE id = $1`,
      { bind: [req.user.userId] }
    );

    logger.info(`2FA disabled for user ${req.user.userId}`);

    res.json({
      success: true,
      message: '2FA has been disabled'
    });
  } catch (error) {
    logger.error('Error disabling 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disable 2FA'
    });
  }
});

/**
 * POST /api/v1/auth/2fa/regenerate-backup
 * Generate new backup codes (invalidates old ones)
 */
router.post('/regenerate-backup', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Current 2FA code is required'
      });
    }

    const centralDb = getCentralDbConnection();

    const [userRows] = await centralDb.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1',
      { bind: [req.user.userId] }
    );
    const user = userRows[0];

    if (!user || !user.totp_enabled) {
      return res.status(400).json({
        success: false,
        error: '2FA is not enabled'
      });
    }

    // Verify current code
    const secret = totpService.decryptSecret(user.totp_secret, ENCRYPTION_KEY);
    const isValid = totpService.verifyTOTP(secret, code);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication code'
      });
    }

    // Generate new backup codes
    const backupCodes = totpService.generateBackupCodes(10);
    const hashedBackupCodes = backupCodes.map(c => totpService.hashBackupCode(c));

    await centralDb.query(
      'UPDATE users SET totp_backup_codes = $1, updated_at = NOW() WHERE id = $2',
      { bind: [hashedBackupCodes, req.user.userId] }
    );

    logger.info(`Backup codes regenerated for user ${req.user.userId}`);

    res.json({
      success: true,
      data: {
        message: 'New backup codes generated. Save these securely.',
        backupCodes: backupCodes
      }
    });
  } catch (error) {
    logger.error('Error regenerating backup codes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to regenerate backup codes'
    });
  }
});

module.exports = router;

/**
 * Authentication Routes - Central Database Only
 * User registration, login, token refresh
 *
 * NOTE: This route DOES NOT use clinicRoutingMiddleware
 * It operates ONLY on the central database (medicalpro_central)
 * for user authentication and company registration.
 *
 * After successful login, JWT includes clinicId (companyId) for subsequent
 * clinic-isolated requests via clinicRoutingMiddleware.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../config/jwt');
const { Company, User, sequelize } = require('../models');
const { logger } = require('../utils/logger');
const Joi = require('joi');
const emailService = require('../services/emailService');
const clinicProvisioningService = require('../services/clinicProvisioningService');

const router = express.Router();

// Schémas de validation
const registerSchema = Joi.object({
  // Company data
  companyName: Joi.string().min(2).max(255).required(),
  country: Joi.string().valid('FR', 'ES').required(),
  businessNumber: Joi.string().max(20).optional(),
  vatNumber: Joi.string().max(20).optional(),
  companyEmail: Joi.string().email().required(),
  companyPhone: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).optional(),

  // User data
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  firstName: Joi.string().max(100).optional(),
  lastName: Joi.string().max(100).optional(),

  // Address (optional)
  address: Joi.object({
    street: Joi.string().max(255).optional(),
    city: Joi.string().max(100).optional(),
    postalCode: Joi.string().max(20).optional(),
    country: Joi.string().max(100).optional()
  }).optional(),

  // Terms acceptance
  acceptTerms: Joi.boolean().valid(true).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  rememberMe: Joi.boolean().default(false)
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required()
});

/**
 * @route POST /api/v1/auth/register
 * @desc Register new company and user with email verification
 * @desc User must verify email before accessing the platform
 * @desc Clinic database is auto-provisioned upon successful registration
 * @access Public
 */
router.post('/register', async (req, res, next) => {
  try {
    // Validation
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(detail => detail.message).join(', ')
        }
      });
    }

    const {
      companyName,
      country,
      businessNumber,
      vatNumber,
      companyEmail,
      companyPhone,
      email,
      password,
      firstName,
      lastName,
      address
    } = value;

    // Vérifier si l'email entreprise existe déjà
    const existingCompany = await Company.findOne({
      where: { email: companyEmail }
    });

    if (existingCompany) {
      return res.status(409).json({
        success: false,
        error: {
          message: 'Company email already exists',
          details: 'This email is already registered for another company'
        }
      });
    }

    // Vérifier si l'email utilisateur existe déjà
    const existingUser = await User.findOne({
      where: { email: email }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: {
          message: 'User email already exists',
          details: 'This email is already registered'
        }
      });
    }

    // Create company and user in transaction
    const result = await sequelize.transaction(async (t) => {
      // Generate clinic database name from company name and UUID
      const clinicId = uuidv4();
      const sanitizedName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const dbName = `medicalpro_clinic_${clinicId.replace(/-/g, '_')}`;

      // Create company
      const company = await Company.create({
        id: clinicId,
        name: companyName,
        country,
        business_number: businessNumber,
        vat_number: vatNumber,
        email: companyEmail,
        phone: companyPhone,
        address: address || {},
        db_name: dbName,
        db_host: process.env.DB_HOST || 'localhost',
        db_port: parseInt(process.env.DB_PORT) || 5432,
        db_user: process.env.DB_USER || 'medicalpro',
        db_password: process.env.DB_PASSWORD || 'medicalpro2024'
      }, { transaction: t });

      // Create user with email_verified = false (pending email verification)
      const user = await User.create({
        company_id: company.id,
        email,
        password_hash: password, // will be hashed by beforeCreate hook
        first_name: firstName,
        last_name: lastName,
        role: 'admin',
        email_verified: false // User cannot login until email is verified
      }, { transaction: t });

      return { company, user };
    });

    // Auto-provision clinic database
    let provisioningResult = null;
    try {
      provisioningResult = await clinicProvisioningService.provisionClinicDatabase({
        clinicId: result.company.id,
        clinicName: result.company.name,
        country: result.company.country
      });
      logger.info(`✅ Clinic database provisioned for: ${result.company.id}`);
    } catch (provisioningError) {
      logger.error(`⚠️ Clinic provisioning failed but registration continues:`, provisioningError.message);
      // Don't fail registration if provisioning fails - can retry later
    }

    // Create email verification token (expires in 24 hours)
    const verificationTokenPayload = {
      userId: result.user.id,
      email: result.user.email,
      companyId: result.company.id,
      type: 'email_verification'
    };

    const verificationToken = jwt.sign(
      verificationTokenPayload,
      process.env.JWT_SECRET || 'your-super-secret-jwt-key',
      { expiresIn: '24h' }
    );

    // Save token to database
    await result.user.update({
      email_verification_token: verificationToken
    });

    // Build verification URL
    const verificationUrl = `${process.env.APP_URL || 'http://localhost:3000'}/auth/verify-email/${verificationToken}`;

    // Send verification email
    try {
      await emailService.sendVerificationEmail({
        email: result.user.email,
        firstName: result.user.first_name || 'User',
        companyName: result.company.name,
        verificationToken,
        verificationUrl
      });
    } catch (emailError) {
      logger.warn(`⚠️ Email sending failed but registration continues:`, emailError.message);
      // Don't fail registration if email fails - user can request resend later
    }

    logger.info(`✅ New company registered (pending email verification): ${companyName}`, {
      companyId: result.company.id,
      userId: result.user.id,
      country,
      emailVerified: false,
      clinicProvisioned: !!provisioningResult
    });

    res.status(201).json({
      success: true,
      data: {
        user: result.user.toSafeJSON(),
        company: result.company.toSafeJSON(),
        clinicProvisioned: !!provisioningResult
      },
      message: 'Registration successful. Please verify your email to activate your account.',
      nextStep: {
        action: 'VERIFY_EMAIL',
        instructions: `A verification link has been sent to ${result.user.email}. Click the link to verify your email and activate your account.`,
        expiresIn: '24 hours'
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/auth/login
 * @desc Authenticate user
 * @access Public
 */
router.post('/login', async (req, res, next) => {
  try {
    // Validation
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(detail => detail.message).join(', ')
        }
      });
    }

    const { email, password, rememberMe } = value;

    // Chercher l'utilisateur avec sa company
    const user = await User.findOne({
      where: {
        email: email.toLowerCase(),
        is_active: true
      },
      include: [{
        model: Company,
        as: 'company',
        required: true
      }]
    });

    if (!user) {
      logger.warn(`Login attempt with non-existent email: ${email}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid credentials',
          details: 'Email or password is incorrect'
        }
      });
    }

    // Vérifier le mot de passe
    const isPasswordValid = await user.validatePassword(password);
    if (!isPasswordValid) {
      logger.warn(`Invalid password attempt for user: ${email}`, {
        userId: user.id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid credentials',
          details: 'Email or password is incorrect'
        }
      });
    }

    // Vérifier que l'email est confirmé
    if (!user.email_verified) {
      logger.warn(`Login attempt with unverified email: ${email}`, {
        userId: user.id,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: {
          message: 'Email not verified',
          details: 'Please verify your email address before logging in'
        },
        nextStep: {
          action: 'VERIFY_EMAIL',
          instructions: 'Check your email for a verification link. If you didn\'t receive it, request a new one.'
        }
      });
    }

    // Mettre à jour last_login
    await user.updateLastLogin();

    // Générer les tokens
    const tokenPayload = {
      userId: user.id,
      companyId: user.company_id,
      email: user.email,
      role: user.role
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    logger.info(`Successful login for user: ${email}`, {
      userId: user.id,
      companyId: user.company_id,
      rememberMe
    });

    res.json({
      success: true,
      data: {
        user: user.toSafeJSON(),
        company: user.company.toSafeJSON(),
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: '24h'
        }
      },
      message: 'Login successful'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/auth/refresh
 * @desc Refresh access token
 * @access Public
 */
router.post('/refresh', async (req, res, next) => {
  try {
    // Validation
    const { error, value } = refreshTokenSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: 'Refresh token is required'
        }
      });
    }

    const { refreshToken } = value;

    // Vérifier le refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Vérifier que l'utilisateur existe toujours
    const user = await User.findByPk(decoded.userId, {
      include: ['company']
    });

    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid refresh token',
          details: 'User not found or inactive'
        }
      });
    }

    // Générer un nouveau access token
    const tokenPayload = {
      userId: user.id,
      companyId: user.company_id,
      email: user.email,
      role: user.role
    };

    const newAccessToken = generateAccessToken(tokenPayload);

    logger.debug(`Token refreshed for user: ${user.email}`, {
      userId: user.id
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        expiresIn: '24h'
      },
      message: 'Token refreshed successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/auth/logout
 * @desc Logout user (invalidate tokens - côté client)
 * @access Private
 */
router.post('/logout', (req, res) => {
  // Pour l'instant, logout côté client seulement
  // TODO: Implémenter blacklist tokens si nécessaire

  logger.info(`User logged out`, {
    userId: req.user?.id,
    ip: req.ip
  });

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * @route GET /api/v1/auth/me
 * @desc Get current user profile
 * @access Private
 */
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, {
      include: [{
        model: Company,
        as: 'company'
      }]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'User not found'
        }
      });
    }

    res.json({
      success: true,
      data: {
        user: user.toSafeJSON(),
        company: user.company.toSafeJSON()
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/auth/verify-email/:token
 * @desc Verify user email address via token
 * @desc User must verify email before being able to login
 * @access Public
 */
router.post('/verify-email/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid request',
          details: 'Verification token is required'
        }
      });
    }

    // Verify and decode the token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key');
    } catch (verifyError) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid or expired verification token',
          details: 'The verification link has expired. Please request a new one.'
        }
      });
    }

    // Check token type
    if (decoded.type !== 'email_verification') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid token type',
          details: 'This token cannot be used for email verification'
        }
      });
    }

    // Find user and verify
    const user = await User.findByPk(decoded.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'User not found',
          details: 'The user account for this verification token does not exist'
        }
      });
    }

    // Check if already verified
    if (user.email_verified) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Email already verified',
          details: 'This email address has already been verified'
        }
      });
    }

    // Mark email as verified
    await user.update({
      email_verified: true,
      email_verified_at: new Date(),
      email_verification_token: null // Clear the token after use
    });

    logger.info(`✅ Email verified for user: ${user.email}`, {
      userId: user.id,
      companyId: user.company_id
    });

    // Send confirmation email (optional - doesn't fail if it fails)
    try {
      const company = await Company.findByPk(user.company_id);
      await emailService.sendVerificationConfirmed({
        email: user.email,
        firstName: user.first_name || 'User',
        companyName: company?.name || 'MedicalPro'
      });
    } catch (emailError) {
      logger.warn(`⚠️ Failed to send confirmation email: ${emailError.message}`);
    }

    res.json({
      success: true,
      data: {
        user: user.toSafeJSON()
      },
      message: 'Email verified successfully! You can now login to your account.',
      nextStep: {
        action: 'LOGIN',
        instructions: 'Go to the login page and enter your email and password to access your account.'
      }
    });

  } catch (error) {
    logger.error('Email verification error:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/auth/resend-verification-email
 * @desc Request a new email verification link
 * @access Public
 */
router.post('/resend-verification-email', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid request',
          details: 'Email address is required'
        }
      });
    }

    const user = await User.findOne({
      where: { email: email.toLowerCase() },
      include: [{ model: Company, as: 'company' }]
    });

    if (!user) {
      // Don't reveal if email exists
      return res.json({
        success: true,
        message: 'If this email exists, a new verification link has been sent.'
      });
    }

    // If already verified, no need to resend
    if (user.email_verified) {
      return res.json({
        success: true,
        message: 'This email address is already verified. You can login now.'
      });
    }

    // Generate new verification token
    const verificationTokenPayload = {
      userId: user.id,
      email: user.email,
      companyId: user.company_id,
      type: 'email_verification'
    };

    const verificationToken = jwt.sign(
      verificationTokenPayload,
      process.env.JWT_SECRET || 'your-super-secret-jwt-key',
      { expiresIn: '24h' }
    );

    // Save new token
    await user.update({
      email_verification_token: verificationToken
    });

    // Build verification URL
    const verificationUrl = `${process.env.APP_URL || 'http://localhost:3000'}/auth/verify-email/${verificationToken}`;

    // Send verification email
    try {
      await emailService.sendVerificationEmail({
        email: user.email,
        firstName: user.first_name || 'User',
        companyName: user.company.name,
        verificationToken,
        verificationUrl
      });
    } catch (emailError) {
      logger.warn(`⚠️ Failed to send resend verification email:`, emailError.message);
    }

    logger.info(`✅ Verification email resent to: ${user.email}`, {
      userId: user.id,
      companyId: user.company_id
    });

    res.json({
      success: true,
      message: 'A new verification link has been sent to your email address.'
    });

  } catch (error) {
    logger.error('Resend verification email error:', error);
    next(error);
  }
});

module.exports = router;
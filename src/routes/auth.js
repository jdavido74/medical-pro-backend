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
const { Company, User, UserClinicMembership, sequelize } = require('../models');
const { getClinicConnection, getCentralConnection } = require('../config/connectionManager');
const { getCentralDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');
const Joi = require('joi');
const emailService = require('../services/emailService');
const clinicProvisioningService = require('../services/clinicProvisioningService');
const { formatAuthResponse } = require('../utils/authHelpers');

const router = express.Router();

// Schémas de validation
const registerSchema = Joi.object({
  // Company data
  companyName: Joi.string().min(2).max(255).required(),
  country: Joi.string().valid('FR', 'ES', 'GB').required(),
  locale: Joi.string().valid('fr-FR', 'es-ES', 'en-GB').optional(),
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
  rememberMe: Joi.boolean().default(false),
  companyId: Joi.string().uuid().optional().allow(null), // For multi-clinic: specify which clinic to login to
  totpCode: Joi.string().length(6).pattern(/^\d+$/).optional().allow(null, '') // 6-digit TOTP code or backup code
    .messages({ 'string.pattern.base': 'TOTP code must be 6 digits' })
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required()
});

/**
 * Helper: Get permissions from clinic_roles table
 * This is the source of truth for role permissions (instead of hardcoded values)
 *
 * @param {string} companyId - Company UUID
 * @param {string} roleName - Role name (admin, physician, practitioner, etc.)
 * @returns {Promise<Array<string>|null>} Permissions array or null if not found
 */
async function getPermissionsFromClinicRoles(companyId, roleName) {
  try {
    const clinicDb = await getClinicConnection(companyId);
    if (!clinicDb) {
      logger.warn(`[getPermissionsFromClinicRoles] No clinic connection for company ${companyId}`);
      return null;
    }

    // Query clinic_roles for this role
    const [roles] = await clinicDb.query(
      `SELECT permissions FROM clinic_roles WHERE name = $1 LIMIT 1`,
      { bind: [roleName] }
    );

    if (roles && roles.length > 0 && roles[0].permissions) {
      // permissions is stored as JSONB array
      const permissions = roles[0].permissions;
      logger.debug(`[getPermissionsFromClinicRoles] Found ${permissions.length} permissions for role ${roleName}`);
      return permissions;
    }

    logger.debug(`[getPermissionsFromClinicRoles] No clinic_roles entry found for role ${roleName}`);
    return null;
  } catch (error) {
    logger.warn(`[getPermissionsFromClinicRoles] Error querying clinic_roles: ${error.message}`);
    return null;
  }
}

/**
 * @route POST /api/v1/auth/register
 * @desc Register new company and user with email verification
 * @desc User must verify email before accessing the platform
 * @desc DEFERRED PROVISIONING: Clinic database is created on FIRST LOGIN after email verification
 * @desc This makes registration fast (~1s instead of ~14s)
 * @access Public
 */
router.post('/register', async (req, res, next) => {
  let transaction;
  let clinicId = null;

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
      locale,
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

    // Derive locale from country if not provided
    const derivedLocale = locale || (country === 'ES' ? 'es-ES' : country === 'GB' ? 'en-GB' : 'fr-FR');

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

    // ============================================================
    // ÉTAPE 1: Create company and user in transaction
    // NOTE: Clinic database will be provisioned on FIRST LOGIN (deferred)
    // ============================================================
    transaction = await sequelize.transaction();

    // Generate clinic database name from company name and UUID
    clinicId = uuidv4();
    const dbName = `medicalpro_clinic_${clinicId.replace(/-/g, '_')}`;

    // Create company with clinic_db_provisioned = false (will be provisioned on first login)
    const company = await Company.create({
      id: clinicId,
      name: companyName,
      country,
      locale: derivedLocale,
      business_number: businessNumber,
      vat_number: vatNumber,
      email: companyEmail,
      phone: companyPhone,
      address: address || {},
      db_name: dbName,
      db_host: process.env.DB_HOST || 'localhost',
      db_port: parseInt(process.env.DB_PORT) || 5432,
      db_user: process.env.DB_USER || 'medicalpro',
      db_password: process.env.DB_PASSWORD || 'medicalpro2024',
      clinic_db_provisioned: false // DEFERRED: Will be provisioned on first login
    }, { transaction });

    // Create user with email_verified = false (pending email verification)
    const user = await User.create({
      company_id: company.id,
      email,
      password_hash: password, // will be hashed by beforeCreate hook
      first_name: firstName,
      last_name: lastName,
      role: 'admin',
      email_verified: false // User cannot login until email is verified
    }, { transaction });

    // ============================================================
    // ÉTAPE 2: COMMIT the transaction (fast - no DB provisioning)
    // ============================================================
    await transaction.commit();
    logger.info(`✅ Registration successful (deferred provisioning) for: ${user.email}`, {
      companyId: company.id,
      userId: user.id,
      clinicDbProvisioned: false
    });

    // ============================================================
    // ÉTAPE 3: Create email verification token and send email
    // ============================================================
    const verificationTokenPayload = {
      userId: user.id,
      email: user.email,
      companyId: company.id,
      type: 'email_verification'
    };

    const verificationToken = jwt.sign(
      verificationTokenPayload,
      process.env.JWT_SECRET || 'your-super-secret-jwt-key',
      { expiresIn: '24h' }
    );

    // Save token to database (outside transaction since it's already committed)
    await user.update({
      email_verification_token: verificationToken
    });

    // Build verification URL with locale
    const verificationUrl = `${process.env.APP_URL || 'http://localhost:3000'}/${company.locale}/auth/verify-email/${verificationToken}`;

    // Send verification email asynchronously (fire-and-forget to avoid blocking registration)
    emailService.sendVerificationEmail({
      email: user.email,
      firstName: user.first_name || 'User',
      companyName: company.name,
      verificationToken,
      verificationUrl,
      region: company.country || 'FR'
    }).then(() => {
      logger.info(`✅ Verification email sent to: ${user.email}`);
    }).catch((emailError) => {
      logger.warn(`⚠️ Email sending failed but registration succeeded:`, emailError.message);
      // Don't fail registration if email fails - user can request resend later
    });

    logger.info(`✅ New company registered (deferred provisioning): ${companyName}`, {
      companyId: company.id,
      userId: user.id,
      country,
      emailVerified: false,
      clinicDbProvisioned: false
    });

    res.status(201).json({
      success: true,
      data: {
        user: user.toSafeJSON(),
        company: company.toSafeJSON(),
        clinicDbProvisioned: false // Clinic DB will be created on first login
      },
      message: 'Registration successful. Please verify your email to activate your account.',
      nextStep: {
        action: 'VERIFY_EMAIL',
        instructions: `A verification link has been sent to ${user.email}. Click the link to verify your email and activate your account.`,
        expiresIn: '24 hours'
      }
    });

  } catch (error) {
    // ============================================================
    // ROLLBACK: Handle registration failure
    // ============================================================
    logger.error('❌ Registration failed:', {
      error: error.message,
      clinicId,
      stack: error.stack
    });

    // Rollback database transaction if it exists
    if (transaction) {
      try {
        await transaction.rollback();
        logger.info('🔄 Database transaction rolled back');
      } catch (rollbackError) {
        logger.error('❌ Failed to rollback transaction:', rollbackError.message);
      }
    }

    // Return clear error message to user
    return res.status(500).json({
      success: false,
      error: {
        message: 'Registration failed',
        details: 'We could not complete your registration. Please try again later or contact support if the problem persists.',
        technicalDetails: process.env.NODE_ENV === 'development' ? error.message : undefined,
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * @route POST /api/v1/auth/login
 * @desc Authenticate user - PHASE 1 SECURITY FIX
 * @desc NOUVEAU FLOW UNIFIÉ:
 *   1. TOUJOURS chercher l'utilisateur dans la base CENTRALE (users table)
 *   2. TOUJOURS vérifier le mot de passe contre users.password_hash (JAMAIS healthcare_providers)
 *   3. Si multiple clinics et pas de companyId → retourner liste des cliniques
 *   4. Générer JWT avec users.id (JAMAIS healthcare_providers.id)
 *
 * SÉCURITÉ:
 *   - Un seul mot de passe par utilisateur (base centrale)
 *   - Un seul ID utilisateur (users.id)
 *   - Pas de confusion entre sources de vérité
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

    const { email, password, rememberMe, companyId } = value;
    const normalizedEmail = email.toLowerCase();

    // ============================================================
    // ÉTAPE 1: TOUJOURS chercher l'utilisateur dans la base CENTRALE
    // C'est la SEULE source de vérité pour l'authentification
    // ============================================================
    const centralUser = await User.findOne({
      where: {
        email: normalizedEmail
      },
      include: [{
        model: Company,
        as: 'company'
      }]
    });

    if (!centralUser) {
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

    // ============================================================
    // ÉTAPE 2: Vérifier le mot de passe UNIQUEMENT contre la base centrale
    // JAMAIS contre healthcare_providers
    // ============================================================
    const isPasswordValid = await centralUser.validatePassword(password);
    if (!isPasswordValid) {
      logger.warn(`Invalid password attempt for: ${email}`, {
        userId: centralUser.id,
        ip: req.ip
      });

      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid credentials',
          details: 'Email or password is incorrect'
        }
      });
    }

    // Vérifier que l'utilisateur est actif
    if (!centralUser.is_active) {
      logger.warn(`Inactive user login attempt: ${email}`, {
        userId: centralUser.id,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: {
          message: 'Account inactive',
          details: 'Your account has been deactivated. Please contact support.'
        }
      });
    }

    // Vérifier que l'email est vérifié
    if (!centralUser.email_verified) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Email not verified',
          details: 'Please verify your email address before logging in'
        },
        nextStep: {
          action: 'VERIFY_EMAIL',
          instructions: 'Check your email for a verification link.'
        }
      });
    }

    // ============================================================
    // ÉTAPE 2.5: Vérifier la double authentification (2FA/TOTP)
    // ============================================================
    const { totpCode } = value;

    // Check if user has 2FA enabled
    const centralDb = getCentralDbConnection();
    const [userWith2FARows] = await centralDb.query(
      'SELECT totp_enabled, totp_secret, totp_backup_codes FROM users WHERE id = $1',
      { bind: [centralUser.id] }
    );
    const userWith2FA = userWith2FARows[0];

    if (userWith2FA && userWith2FA.totp_enabled) {
      // 2FA is enabled - check if code was provided
      if (!totpCode) {
        // No code provided - ask for it
        logger.info(`2FA required for user: ${email}`, { userId: centralUser.id });

        return res.json({
          success: true,
          data: {
            requires2FA: true,
            userId: centralUser.id
          },
          nextStep: {
            action: 'VERIFY_2FA',
            instructions: 'Enter the 6-digit code from your authenticator app'
          },
          message: 'Two-factor authentication required'
        });
      }

      // Code provided - verify it
      const totpService = require('../services/totpService');
      const ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET;

      let isValidCode = false;

      try {
        const secret = totpService.decryptSecret(userWith2FA.totp_secret, ENCRYPTION_KEY);
        isValidCode = totpService.verifyTOTP(secret, totpCode);

        // If TOTP fails, try backup code
        if (!isValidCode && userWith2FA.totp_backup_codes && userWith2FA.totp_backup_codes.length > 0) {
          const backupIndex = totpService.verifyBackupCode(totpCode, userWith2FA.totp_backup_codes);
          if (backupIndex !== -1) {
            isValidCode = true;
            // Remove used backup code
            const remainingCodes = [...userWith2FA.totp_backup_codes];
            remainingCodes.splice(backupIndex, 1);
            await centralDb.query(
              'UPDATE users SET totp_backup_codes = $1 WHERE id = $2',
              { bind: [remainingCodes, centralUser.id] }
            );
            logger.warn(`Backup code used for user ${centralUser.id}. ${remainingCodes.length} codes remaining.`);
          }
        }
      } catch (err) {
        logger.error('2FA verification error:', err);
        isValidCode = false;
      }

      if (!isValidCode) {
        logger.warn(`Invalid 2FA code for user: ${email}`, { userId: centralUser.id });
        return res.status(401).json({
          success: false,
          error: {
            message: 'Invalid 2FA code',
            details: 'The authentication code is incorrect. Please try again.'
          }
        });
      }

      logger.info(`2FA verified for user: ${email}`, { userId: centralUser.id });
    }

    // ============================================================
    // ÉTAPE 3: Déterminer les cliniques accessibles
    // Chercher les memberships OU utiliser la clinique principale
    // ============================================================
    const memberships = await UserClinicMembership.findAll({
      where: {
        email: normalizedEmail,
        is_active: true
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'country', 'locale', 'email']
      }],
      order: [['is_primary', 'DESC'], ['created_at', 'ASC']]
    });

    // Construire la liste des cliniques accessibles
    let accessibleClinics = [];

    // Ajouter la clinique principale (users.company_id) si elle existe
    if (centralUser.company && centralUser.company.id) {
      accessibleClinics.push({
        id: centralUser.company.id,
        name: centralUser.company.name,
        country: centralUser.company.country,
        locale: centralUser.company.locale || 'fr-FR',
        email: centralUser.company.email,
        roleInClinic: centralUser.role,
        isPrimary: true,
        source: 'primary'
      });
    }

    // Ajouter les cliniques via memberships (éviter les doublons)
    for (const membership of memberships) {
      if (!accessibleClinics.find(c => c.id === membership.company_id)) {
        accessibleClinics.push({
          id: membership.company_id,
          name: membership.company.name,
          country: membership.company.country,
          locale: membership.company.locale || 'fr-FR',
          email: membership.company.email,
          roleInClinic: membership.role_in_clinic,
          isPrimary: membership.is_primary,
          source: 'membership'
        });
      }
    }

    // ============================================================
    // SUPER_ADMIN SPECIAL CASE: No clinic required
    // Super admins manage the SaaS platform, not clinics
    // ============================================================
    if (centralUser.role === 'super_admin') {
      logger.info(`✅ Super admin login: ${email}`, {
        userId: centralUser.id,
        role: centralUser.role
      });

      await centralUser.updateLastLogin();

      const tokenPayload = {
        userId: centralUser.id,
        companyId: null, // Super admin has no company
        email: centralUser.email,
        role: centralUser.role
      };

      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      return res.json({
        success: true,
        data: {
          user: centralUser.toSafeJSON(),
          company: null,
          subscription: null,
          permissions: ['*'], // Super admin has all permissions
          tokens: {
            accessToken,
            refreshToken,
            expiresIn: '24h'
          },
          isSuperAdmin: true
        },
        message: 'Super admin login successful'
      });
    }

    // Si aucune clinique accessible (for non-super_admin users)
    if (accessibleClinics.length === 0) {
      logger.warn(`User has no accessible clinics: ${email}`, {
        userId: centralUser.id
      });

      return res.status(403).json({
        success: false,
        error: {
          message: 'No clinic access',
          details: 'You do not have access to any clinic. Please contact your administrator.'
        }
      });
    }

    // ============================================================
    // ÉTAPE 4: Si plusieurs cliniques et pas de sélection, demander
    // ============================================================
    if (accessibleClinics.length > 1 && !companyId) {
      logger.info(`Multi-clinic user needs to select clinic: ${email}`, {
        userId: centralUser.id,
        clinicCount: accessibleClinics.length
      });

      // Note: On ne vérifie pas encore le mot de passe complètement ici
      // car l'utilisateur doit d'abord sélectionner sa clinique
      // MAIS on a déjà validé le mot de passe ci-dessus (étape 2)

      return res.json({
        success: true,
        data: {
          requiresClinicSelection: true,
          clinics: accessibleClinics.map(c => ({
            id: c.id,
            name: c.name,
            country: c.country,
            locale: c.locale,
            roleInClinic: c.roleInClinic,
            isPrimary: c.isPrimary
          }))
        },
        nextStep: {
          action: 'SELECT_CLINIC',
          instructions: 'Please select which clinic you want to log into'
        },
        message: 'Multiple clinics found. Please select one.'
      });
    }

    // ============================================================
    // ÉTAPE 5: Déterminer la clinique cible
    // ============================================================
    let targetClinic;

    if (companyId) {
      // Clinique spécifiée - vérifier l'accès
      targetClinic = accessibleClinics.find(c => c.id === companyId);
      if (!targetClinic) {
        logger.warn(`User tried to access unauthorized clinic: ${email}`, {
          userId: centralUser.id,
          requestedCompanyId: companyId
        });

        return res.status(403).json({
          success: false,
          error: {
            message: 'Clinic access denied',
            details: 'You do not have access to the selected clinic'
          }
        });
      }
    } else {
      // Utiliser la première clinique (primaire ou première de la liste)
      targetClinic = accessibleClinics[0];
    }

    // ============================================================
    // ÉTAPE 6: Vérifier que la clinique existe et est accessible
    // ============================================================
    const company = await Company.findByPk(targetClinic.id);
    if (!company) {
      logger.error(`Clinic not found during login: ${targetClinic.id}`, {
        userId: centralUser.id
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'Clinic not available',
          details: 'The selected clinic is not available. Please try again.'
        }
      });
    }

    // ============================================================
    // ÉTAPE 6.5: DEFERRED PROVISIONING CHECK
    // If clinic database is not provisioned, return special response
    // Frontend will redirect to provisioning page
    // ============================================================
    if (!company.clinic_db_provisioned) {
      logger.info(`🔧 Clinic DB not provisioned, returning provisioning required: ${company.id}`, {
        userId: centralUser.id,
        companyId: company.id,
        companyName: company.name
      });

      // Generate a temporary token for provisioning (shorter expiry)
      const provisioningTokenPayload = {
        userId: centralUser.id,
        companyId: company.id,
        email: centralUser.email,
        role: centralUser.role,
        type: 'provisioning'
      };

      const provisioningToken = jwt.sign(
        provisioningTokenPayload,
        process.env.JWT_SECRET || 'your-super-secret-jwt-key',
        { expiresIn: '1h' } // 1 hour for provisioning
      );

      return res.json({
        success: true,
        data: {
          requiresProvisioning: true,
          provisioningToken,
          user: centralUser.toSafeJSON(),
          company: {
            id: company.id,
            name: company.name,
            country: company.country,
            locale: company.locale
          }
        },
        message: 'Clinic setup required. Please wait while we configure your clinic.',
        nextStep: {
          action: 'PROVISION_CLINIC',
          instructions: 'Your clinic database is being set up. This only happens once.'
        }
      });
    }

    // ============================================================
    // ÉTAPE 7: Mettre à jour last_login et générer les tokens
    // Le JWT contient TOUJOURS users.id (jamais healthcare_providers.id)
    // ============================================================
    await centralUser.updateLastLogin();

    const tokenPayload = {
      userId: centralUser.id,       // TOUJOURS users.id (base centrale)
      companyId: targetClinic.id,   // Clinique active
      email: centralUser.email,
      role: centralUser.role        // Rôle de la base centrale
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    logger.info(`✅ Successful login for: ${email}`, {
      userId: centralUser.id,
      companyId: targetClinic.id,
      companyName: targetClinic.name,
      role: centralUser.role,
      authSource: 'central_db'  // Log pour confirmer l'authentification centrale
    });

    // Charger les permissions depuis clinic_roles (source de vérité)
    const clinicRolePermissions = await getPermissionsFromClinicRoles(targetClinic.id, centralUser.role);

    // OPTIMISATION: Utiliser formatAuthResponse pour retourner user + company + subscription + permissions
    // Cela évite au frontend de faire un appel /auth/me supplémentaire après le login
    const authData = await formatAuthResponse(centralUser, company, clinicRolePermissions);

    // Récupérer le provider_id depuis la base clinique
    let providerId = null;
    try {
      const clinicDb = await getClinicConnection(targetClinic.id);
      const [providers] = await clinicDb.query(
        `SELECT id FROM healthcare_providers WHERE central_user_id = :centralUserId LIMIT 1`,
        { replacements: { centralUserId: centralUser.id } }
      );
      if (providers && providers.length > 0) {
        providerId = providers[0].id;
      }
    } catch (providerError) {
      logger.warn('Could not fetch provider_id during login', { error: providerError.message });
    }

    res.json({
      success: true,
      data: {
        ...authData,  // Inclut: user, company, subscription, permissions
        providerId,   // ID du healthcare_provider pour les opérations cliniques
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: '24h'
        }
      },
      message: 'Login successful'
    });

  } catch (error) {
    logger.error('Login error:', { error: error.message, stack: error.stack });
    next(error);
  }
});

/**
 * @route POST /api/v1/auth/refresh
 * @desc Refresh access token - PHASE 1 SECURITY FIX
 * @desc TOUJOURS vérifier l'utilisateur dans la base CENTRALE uniquement
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

    // ============================================================
    // PHASE 1 FIX: TOUJOURS vérifier dans la base CENTRALE
    // Plus de recherche dans healthcare_providers
    // ============================================================
    const centralUser = await User.findByPk(decoded.userId, {
      attributes: ['id', 'email', 'role', 'company_id', 'is_active']
    });

    if (!centralUser) {
      logger.warn(`Refresh token for non-existent user`, {
        jwtUserId: decoded.userId,
        ip: req.ip
      });

      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid refresh token',
          details: 'User not found',
          code: 'USER_NOT_FOUND'
        }
      });
    }

    if (!centralUser.is_active) {
      logger.warn(`Refresh token for inactive user`, {
        userId: centralUser.id,
        email: centralUser.email
      });

      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid refresh token',
          details: 'User account is inactive',
          code: 'ACCOUNT_INACTIVE'
        }
      });
    }

    // Valider que le companyId du token est toujours valide
    const jwtCompanyId = decoded.companyId;
    let validatedCompanyId = jwtCompanyId;

    // Vérifier que l'utilisateur a toujours accès à cette clinique
    if (jwtCompanyId !== centralUser.company_id) {
      const membership = await UserClinicMembership.findOne({
        where: {
          email: centralUser.email,
          company_id: jwtCompanyId,
          is_active: true
        }
      });

      if (!membership) {
        // L'utilisateur n'a plus accès à cette clinique, utiliser sa clinique principale
        logger.warn(`User lost access to clinic, reverting to primary`, {
          userId: centralUser.id,
          lostCompanyId: jwtCompanyId,
          primaryCompanyId: centralUser.company_id
        });
        validatedCompanyId = centralUser.company_id;
      }
    }

    // Générer un nouveau access token avec les données de la base centrale
    const tokenPayload = {
      userId: centralUser.id,       // TOUJOURS users.id
      companyId: validatedCompanyId,
      email: centralUser.email,
      role: centralUser.role        // Rôle de la base centrale
    };

    const newAccessToken = generateAccessToken(tokenPayload);

    logger.debug(`Token refreshed for user: ${centralUser.email}`, {
      userId: centralUser.id,
      companyId: validatedCompanyId,
      authSource: 'central_db'
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
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Refresh token expired',
          details: 'Please login again',
          code: 'REFRESH_TOKEN_EXPIRED'
        }
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid refresh token',
          details: 'Token is malformed',
          code: 'REFRESH_TOKEN_INVALID'
        }
      });
    }

    next(error);
  }
});

/**
 * @route POST /api/v1/auth/provision-clinic
 * @desc Provision clinic database (deferred provisioning)
 * @desc Called after successful login when clinic_db_provisioned = false
 * @desc This creates the clinic database, runs migrations, and initializes default data
 * @access Requires provisioning token (from login response)
 */
router.post('/provision-clinic', async (req, res, next) => {
  try {
    const { provisioningToken } = req.body;

    if (!provisioningToken) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Provisioning token required',
          details: 'A valid provisioning token is required to set up the clinic'
        }
      });
    }

    // Verify the provisioning token
    let decoded;
    try {
      decoded = jwt.verify(provisioningToken, process.env.JWT_SECRET || 'your-super-secret-jwt-key');
    } catch (verifyError) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid or expired provisioning token',
          details: 'Please login again to restart the setup process'
        }
      });
    }

    // Verify token type
    if (decoded.type !== 'provisioning') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid token type',
          details: 'This token cannot be used for provisioning'
        }
      });
    }

    // Get user and company
    const centralUser = await User.findByPk(decoded.userId);
    if (!centralUser) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'User not found',
          details: 'The user associated with this token no longer exists'
        }
      });
    }

    const company = await Company.findByPk(decoded.companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Clinic not found',
          details: 'The clinic associated with this token no longer exists'
        }
      });
    }

    // Check if already provisioned (idempotent - prevents double provisioning)
    if (company.clinic_db_provisioned) {
      logger.info(`Clinic already provisioned, skipping: ${company.id}`);

      // Generate normal auth tokens and return success
      const tokenPayload = {
        userId: centralUser.id,
        companyId: company.id,
        email: centralUser.email,
        role: centralUser.role
      };

      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      // Charger les permissions depuis clinic_roles
      const clinicRolePermissions = await getPermissionsFromClinicRoles(company.id, centralUser.role);
      const authData = await formatAuthResponse(centralUser, company, clinicRolePermissions);

      return res.json({
        success: true,
        data: {
          ...authData,
          tokens: {
            accessToken,
            refreshToken,
            expiresIn: '24h'
          },
          provisioned: true,
          message: 'Clinic was already set up'
        },
        message: 'Clinic setup complete. Welcome!'
      });
    }

    // ============================================================
    // PROVISION THE CLINIC DATABASE
    // ============================================================
    logger.info(`🔧 Starting deferred clinic provisioning for: ${company.id}`, {
      companyId: company.id,
      companyName: company.name,
      userId: centralUser.id
    });

    // Step 1: Provision the database
    const provisioningResult = await clinicProvisioningService.provisionClinicDatabase({
      clinicId: company.id,
      clinicName: company.name,
      country: company.country
    });

    if (!provisioningResult || !provisioningResult.success) {
      logger.error(`❌ Clinic provisioning failed for: ${company.id}`, {
        result: provisioningResult
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'Clinic setup failed',
          details: 'We could not set up your clinic. Please try again or contact support.',
          code: 'PROVISIONING_FAILED'
        }
      });
    }

    logger.info(`✅ Clinic database created for: ${company.id}`);

    // Step 2: Verify the database is accessible
    const dbVerified = await clinicProvisioningService.verifyClinicDatabase(company.id);

    if (!dbVerified) {
      logger.error(`❌ Clinic database verification failed for: ${company.id}`);

      // Try to cleanup
      try {
        await clinicProvisioningService.cleanupFailedProvisioning(company.id);
      } catch (cleanupError) {
        logger.error('Failed to cleanup after verification failure:', cleanupError);
      }

      return res.status(500).json({
        success: false,
        error: {
          message: 'Clinic setup verification failed',
          details: 'The clinic was set up but could not be verified. Please try again.',
          code: 'VERIFICATION_FAILED'
        }
      });
    }

    logger.info(`✅ Clinic database verified for: ${company.id}`);

    // Step 3: Create healthcare provider in clinic database
    const dbConfig = {
      host: company.db_host || process.env.DB_HOST || 'localhost',
      port: company.db_port || parseInt(process.env.DB_PORT) || 5432,
      user: company.db_user || process.env.DB_USER || 'medicalpro',
      password: company.db_password || process.env.DB_PASSWORD || 'medicalpro2024'
    };

    try {
      await clinicProvisioningService.createHealthcareProviderInClinic(
        company.db_name,
        dbConfig.user,
        dbConfig.password,
        dbConfig.host,
        dbConfig.port,
        company.id,
        centralUser.toJSON ? centralUser.toJSON() : centralUser.dataValues
      );
      logger.info(`✅ Healthcare provider synced for: ${centralUser.email}`);
    } catch (providerError) {
      logger.warn(`⚠️ Healthcare provider sync failed (non-critical): ${providerError.message}`);
      // Don't fail - provider can be created later
    }

    // Step 4: Mark company as provisioned
    await company.markClinicDbProvisioned();
    logger.info(`✅ Clinic marked as provisioned: ${company.id}`);

    // Step 5: Generate auth tokens
    await centralUser.updateLastLogin();

    const tokenPayload = {
      userId: centralUser.id,
      companyId: company.id,
      email: centralUser.email,
      role: centralUser.role
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Charger les permissions depuis clinic_roles (après provisioning, les rôles existent)
    const clinicRolePermissions = await getPermissionsFromClinicRoles(company.id, centralUser.role);
    const authData = await formatAuthResponse(centralUser, company, clinicRolePermissions);

    logger.info(`✅ Deferred provisioning complete for: ${company.name}`, {
      companyId: company.id,
      userId: centralUser.id,
      email: centralUser.email
    });

    res.json({
      success: true,
      data: {
        ...authData,
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: '24h'
        },
        provisioned: true
      },
      message: 'Your clinic is ready! Welcome to MedicalPro.'
    });

  } catch (error) {
    logger.error('Clinic provisioning error:', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: {
        message: 'Clinic setup failed',
        details: 'An unexpected error occurred during setup. Please try again.',
        technicalDetails: process.env.NODE_ENV === 'development' ? error.message : undefined
      }
    });
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

// SUPPRIMÉ: Ancienne route /me qui ne supportait que les utilisateurs centraux
// La nouvelle route /me plus bas supporte les utilisateurs centraux ET cliniques

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
        companyName: company?.name || 'MedicalPro',
        region: company?.country || 'FR'
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

    // Build verification URL with locale
    const verificationUrl = `${process.env.APP_URL || 'http://localhost:3000'}/${user.company.locale}/auth/verify-email/${verificationToken}`;

    // Send verification email
    try {
      await emailService.sendVerificationEmail({
        email: user.email,
        firstName: user.first_name || 'User',
        companyName: user.company.name,
        verificationToken,
        verificationUrl,
        region: user.company.country || 'FR'
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

/**
 * @route GET /api/v1/auth/me
 * @desc Récupérer les données actuelles de l'utilisateur et ses permissions
 * @desc PHASE 1 SECURITY FIX: Utilise UNIQUEMENT la base centrale
 * @desc CRITIQUE: Source de vérité pour les permissions (pas localStorage!)
 * @access Private (requires valid JWT)
 *
 * NOTE: authMiddleware a déjà validé:
 *   - L'utilisateur existe en base centrale
 *   - Le companyId du JWT est valide
 *   - Le rôle n'a pas été modifié
 */
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res, next) => {
  try {
    // authMiddleware a déjà validé l'utilisateur
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          timestamp: new Date().toISOString()
        }
      });
    }

    // ============================================================
    // PHASE 1 FIX: TOUJOURS récupérer depuis la base CENTRALE
    // Plus de recherche dans healthcare_providers
    // ============================================================
    const centralUser = await User.findByPk(req.user.id, {
      attributes: ['id', 'email', 'first_name', 'last_name', 'role', 'permissions', 'is_active'],
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'country', 'locale', 'email', 'phone', 'business_number', 'vat_number', 'setup_completed_at']
      }]
    });

    // L'utilisateur DOIT exister car authMiddleware l'a déjà validé
    if (!centralUser) {
      logger.error(`User not found in /me but passed authMiddleware - should not happen`, {
        userId: req.user.id,
        ip: req.ip
      });

      return res.status(401).json({
        success: false,
        error: {
          message: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Récupérer la company active (peut être différente de la company principale)
    const activeCompanyId = req.user.companyId;
    let activeCompany = centralUser.company;

    // Si la company active est différente de la principale, récupérer ses infos
    if (activeCompanyId && activeCompanyId !== centralUser.company?.id) {
      activeCompany = await Company.findByPk(activeCompanyId, {
        attributes: ['id', 'name', 'country', 'locale', 'email', 'phone', 'business_number', 'vat_number', 'settings', 'setup_completed_at']
      });
    }

    // Charger les permissions depuis clinic_roles (source de vérité)
    const clinicRolePermissions = await getPermissionsFromClinicRoles(activeCompanyId, centralUser.role);

    // OPTIMISATION: Utiliser formatAuthResponse pour garantir la même structure que /auth/login
    // Cela évite les incohérences entre login et /me
    const authData = await formatAuthResponse(centralUser, activeCompany, clinicRolePermissions);

    // Récupérer le provider_id depuis la base clinique (même logique que /login)
    let providerId = null;
    try {
      if (activeCompanyId) {
        const clinicDb = await getClinicConnection(activeCompanyId);
        const [providers] = await clinicDb.query(
          `SELECT id FROM healthcare_providers WHERE central_user_id = :centralUserId LIMIT 1`,
          { replacements: { centralUserId: centralUser.id } }
        );
        if (providers && providers.length > 0) {
          providerId = providers[0].id;
        }
      }
    } catch (providerError) {
      logger.warn('Could not fetch provider_id in /me', { error: providerError.message });
    }

    logger.debug(`User requested /me endpoint`, {
      userId: authData.user.id,
      email: authData.user.email,
      role: authData.user.role,
      companyId: activeCompanyId,
      providerId,
      authSource: 'central_db',
      ip: req.ip
    });

    res.json({
      success: true,
      data: {
        ...authData,  // Inclut: user, company, subscription, permissions
        providerId,   // ID du healthcare_provider pour les opérations cliniques
        // Info de sécurité supplémentaire pour /me
        tokenVerified: true,
        dataSource: 'central_database',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('/me endpoint error', {
      error: error.message,
      userId: req.user?.id,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: {
        message: 'Failed to retrieve user data',
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * @route GET /api/v1/auth/refresh-permissions
 * @desc Refresh user permissions from clinic_roles table
 * @desc Called after admin modifies role permissions to get updated permissions
 * @access Private (requires authentication)
 */
router.get('/refresh-permissions', async (req, res) => {
  try {
    // Get current user from JWT (requires auth middleware to have validated)
    if (!req.user || !req.user.userId || !req.user.companyId) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required' }
      });
    }

    const { userId, companyId, role } = req.user;

    // Charger les permissions depuis clinic_roles
    const clinicRolePermissions = await getPermissionsFromClinicRoles(companyId, role);

    if (clinicRolePermissions) {
      logger.info(`Permissions refreshed for user ${userId}`, {
        userId,
        companyId,
        role,
        permissionCount: clinicRolePermissions.length
      });

      return res.json({
        success: true,
        data: {
          permissions: clinicRolePermissions,
          role: role,
          refreshedAt: new Date().toISOString()
        }
      });
    }

    // Fallback: permissions non trouvées dans clinic_roles, retourner un message
    logger.warn(`No clinic_roles found for role ${role} in company ${companyId}`);
    return res.json({
      success: true,
      data: {
        permissions: null,
        role: role,
        message: 'No custom permissions found, using default',
        refreshedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error refreshing permissions', {
      error: error.message,
      userId: req.user?.userId,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: { message: 'Failed to refresh permissions' }
    });
  }
});

/**
 * @route GET /api/v1/auth/ip-info
 * @desc Get real client IP address for security audit logging
 * @desc Fixes hardcoded IP issue in frontend (replaces '127.0.0.1' and 'localhost')
 * @access Public (no authentication required)
 */
router.get('/ip-info', (req, res) => {
  try {
    // Get the real client IP
    // Try multiple sources for IP address detection:
    // 1. X-Forwarded-For (proxy/load balancer) - take first IP if multiple
    // 2. X-Real-IP (nginx proxy)
    // 3. req.ip (Express normalized)
    // 4. req.connection.remoteAddress (fallback)

    const xForwardedFor = req.get('x-forwarded-for');
    const clientIP = xForwardedFor
      ? xForwardedFor.split(',')[0].trim()
      : req.ip || req.connection.remoteAddress || 'unknown';

    logger.debug(`IP info requested from ${clientIP}`, {
      clientIP,
      userAgent: req.get('user-agent'),
      referer: req.get('referer')
    });

    res.json({
      success: true,
      data: {
        clientIP,
        userAgent: req.get('user-agent')
      }
    });

  } catch (error) {
    logger.error('IP info endpoint error', { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to retrieve IP info',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ============================================================================
// INVITATION SET PASSWORD ROUTES
// ============================================================================

/**
 * POST /auth/verify-invitation
 * Verify invitation token and return user info
 * Used to show user info on set-password page before they set their password
 */
router.post('/verify-invitation', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: { message: 'Token is required' }
      });
    }

    // Find the healthcare provider with this invitation token
    // Search in each clinic's healthcare_providers table
    const companies = await Company.findAll({ where: { is_active: true } });

    for (const company of companies) {
      try {
        const clinicDb = await getClinicConnection(company.id);
        const [providers] = await clinicDb.query(`
          SELECT id, email, first_name, last_name, role, invitation_token, invitation_expires_at
          FROM healthcare_providers
          WHERE invitation_token = :token
        `, { replacements: { token } });

        if (providers.length > 0) {
          const provider = providers[0];

          // Check if token is expired
          if (provider.invitation_expires_at && new Date(provider.invitation_expires_at) < new Date()) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'TOKEN_EXPIRED',
                message: 'Invitation token has expired'
              }
            });
          }

          return res.json({
            success: true,
            data: {
              email: provider.email,
              firstName: provider.first_name,
              lastName: provider.last_name,
              role: provider.role,
              clinicId: company.id,
              clinicName: company.name
            }
          });
        }
      } catch (err) {
        // Continue to next clinic if this one fails
        console.error(`[auth] Error checking clinic ${company.id}:`, err.message);
      }
    }

    return res.status(404).json({
      success: false,
      error: {
        code: 'TOKEN_NOT_FOUND',
        message: 'Invalid invitation token'
      }
    });

  } catch (error) {
    console.error('[auth] Verify invitation error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to verify invitation', details: error.message }
    });
  }
});

/**
 * POST /auth/set-password
 * Set password for invited user
 * Creates central user account and activates the healthcare provider
 */
router.post('/set-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: { message: 'Token and password are required' }
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: { message: 'Password must be at least 8 characters' }
      });
    }

    // Find the healthcare provider with this invitation token
    let provider = null;
    let clinicDb = null;
    let company = null;

    const companies = await Company.findAll({ where: { is_active: true } });

    for (const comp of companies) {
      try {
        const db = await getClinicConnection(comp.id);
        const [providers] = await db.query(`
          SELECT id, email, first_name, last_name, role, invitation_token, invitation_expires_at, account_status
          FROM healthcare_providers
          WHERE invitation_token = :token
        `, { replacements: { token } });

        if (providers.length > 0) {
          provider = providers[0];
          clinicDb = db;
          company = comp;
          break;
        }
      } catch (err) {
        console.error(`[auth] Error checking clinic ${comp.id}:`, err.message);
      }
    }

    if (!provider) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TOKEN_NOT_FOUND',
          message: 'Invalid invitation token'
        }
      });
    }

    // Check if token is expired
    if (provider.invitation_expires_at && new Date(provider.invitation_expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Invitation token has expired. Please contact your administrator.'
        }
      });
    }

    // Check if already activated
    if (provider.account_status === 'active') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_ACTIVATED',
          message: 'Account is already activated. Please login.'
        }
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Start transaction
    const centralTransaction = await sequelize.transaction();

    try {
      // 1. Create or update central user
      let centralUser = await User.findOne({
        where: { email: provider.email.toLowerCase() },
        transaction: centralTransaction
      });

      if (centralUser) {
        // Update existing user
        await centralUser.update({
          password_hash: hashedPassword,
          email_verified: true,
          first_name: provider.first_name,
          last_name: provider.last_name
        }, { transaction: centralTransaction });
      } else {
        // Create new central user
        // Valid roles: super_admin, admin, physician, practitioner, secretary, readonly
        const validRoles = ['super_admin', 'admin', 'physician', 'practitioner', 'secretary', 'readonly'];
        const centralRole = validRoles.includes(provider.role) ? provider.role : 'practitioner';

        centralUser = await User.create({
          id: uuidv4(),
          email: provider.email.toLowerCase(),
          password_hash: hashedPassword,
          first_name: provider.first_name,
          last_name: provider.last_name,
          role: centralRole,
          company_id: company.id,
          email_verified: true,
          is_active: true
        }, { transaction: centralTransaction });
      }

      // 2. Update healthcare provider in clinic DB
      await clinicDb.query(`
        UPDATE healthcare_providers
        SET
          password_hash = :password_hash,
          account_status = 'active',
          email_verified = true,
          invitation_token = NULL,
          invitation_expires_at = NULL,
          central_user_id = :central_user_id,
          auth_migrated_to_central = true,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = :provider_id
      `, {
        replacements: {
          password_hash: hashedPassword,
          central_user_id: centralUser.id,
          provider_id: provider.id
        }
      });

      // 3. Update or create clinic membership
      await UserClinicMembership.upsertMembership({
        email: provider.email.toLowerCase(),
        companyId: company.id,
        providerId: provider.id,
        roleInClinic: provider.role,
        isPrimary: false,
        displayName: `${provider.first_name} ${provider.last_name}`.trim(),
        isActive: true
      });

      await centralTransaction.commit();

      logger.info(`✅ User ${provider.email} activated via invitation`, {
        email: provider.email,
        clinicId: company.id,
        centralUserId: centralUser.id
      });

      res.json({
        success: true,
        message: 'Account activated successfully. You can now login.',
        data: {
          email: provider.email,
          clinicName: company.name
        }
      });

    } catch (innerError) {
      await centralTransaction.rollback();
      throw innerError;
    }

  } catch (error) {
    console.error('[auth] Set password error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to set password', details: error.message }
    });
  }
});

/**
 * POST /auth/resend-invitation
 * Resend invitation email (admin only)
 */
router.post('/resend-invitation', async (req, res) => {
  try {
    const { providerId, clinicId } = req.body;

    if (!providerId || !clinicId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Provider ID and Clinic ID are required' }
      });
    }

    const company = await Company.findByPk(clinicId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: { message: 'Clinic not found' }
      });
    }

    const clinicDb = await getClinicConnection(clinicId);

    // Get provider
    const [providers] = await clinicDb.query(`
      SELECT id, email, first_name, last_name, role, account_status
      FROM healthcare_providers
      WHERE id = :providerId
    `, { replacements: { providerId } });

    if (providers.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Provider not found' }
      });
    }

    const provider = providers[0];

    // Generate new invitation token
    const crypto = require('crypto');
    const invitationToken = crypto.randomBytes(32).toString('hex');
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Update provider with new token
    await clinicDb.query(`
      UPDATE healthcare_providers
      SET
        invitation_token = :invitationToken,
        invitation_expires_at = :invitationExpiresAt,
        account_status = 'pending',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = :providerId
    `, {
      replacements: {
        invitationToken,
        invitationExpiresAt,
        providerId
      }
    });

    // Send invitation email
    const locale = company.locale || 'fr-FR';
    const language = locale.split('-')[0].toLowerCase();
    const invitationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${locale}/set-password?token=${invitationToken}`;

    await emailService.sendInvitationEmail({
      email: provider.email,
      firstName: provider.first_name,
      lastName: provider.last_name,
      clinicName: company.name,
      role: provider.role,
      invitationUrl,
      expiresAt: invitationExpiresAt,
      language
    });

    res.json({
      success: true,
      message: 'Invitation email resent successfully'
    });

  } catch (error) {
    console.error('[auth] Resend invitation error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to resend invitation', details: error.message }
    });
  }
});

module.exports = router;
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
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../config/jwt');
const { Company, User, sequelize } = require('../models');
const { logger } = require('../utils/logger');
const Joi = require('joi');

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
 * @desc Register new company and user
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

    // Créer l'entreprise et l'utilisateur en transaction
    const result = await sequelize.transaction(async (t) => {
      // Créer l'entreprise
      const company = await Company.create({
        name: companyName,
        country,
        business_number: businessNumber,
        vat_number: vatNumber,
        email: companyEmail,
        phone: companyPhone,
        address: address || {}
      }, { transaction: t });

      // Créer l'utilisateur
      const user = await User.create({
        company_id: company.id,
        email,
        password_hash: password, // sera hashé par le hook beforeCreate
        first_name: firstName,
        last_name: lastName,
        role: 'admin'
      }, { transaction: t });

      return { company, user };
    });

    logger.info(`New company registered: ${companyName}`, {
      companyId: result.company.id,
      userId: result.user.id,
      country
    });

    // Générer les tokens
    const tokenPayload = {
      userId: result.user.id,
      companyId: result.company.id,
      email: result.user.email,
      role: result.user.role
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    res.status(201).json({
      success: true,
      data: {
        user: result.user.toSafeJSON(),
        company: result.company.toSafeJSON(),
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: '24h'
        }
      },
      message: 'Company and user registered successfully'
    });

  } catch (error) {
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

module.exports = router;
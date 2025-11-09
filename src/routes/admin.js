/**
 * Admin Routes - Central Database Management
 * Super admin operations on central database (companies, users, global stats)
 * NOTE: This route DOES NOT use clinicRoutingMiddleware
 * It operates on the central database only (medicalpro_central)
 */

const express = require('express');
const { Company, User, Client, Invoice, Quote } = require('../models');
const { logger } = require('../utils/logger');
const Joi = require('joi');
const { Op } = require('sequelize');

const router = express.Router();

// Middleware pour vérifier les permissions super admin
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Authentication required',
        details: 'No user authenticated'
      }
    });
  }

  // Vérifier si l'utilisateur a le rôle super_admin
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      error: {
        message: 'Forbidden',
        details: 'Super admin access required'
      }
    });
  }

  next();
};

// Schémas de validation
const createCompanySchema = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  country: Joi.string().valid('FR', 'ES').required(),
  email: Joi.string().email().required(),
  businessNumber: Joi.string().max(20).optional(),
  vatNumber: Joi.string().max(20).optional(),
  phone: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).optional(),
  address: Joi.object({
    street: Joi.string().max(255).optional(),
    city: Joi.string().max(100).optional(),
    postalCode: Joi.string().max(20).optional(),
    country: Joi.string().max(100).optional()
  }).optional(),
  settings: Joi.object().optional()
});

const createUserSchema = Joi.object({
  companyId: Joi.string().uuid().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().max(100).optional(),
  lastName: Joi.string().max(100).optional(),
  role: Joi.string().valid('admin', 'user', 'readonly').required(),
  permissions: Joi.object().optional(),
  isActive: Joi.boolean().optional()
});

/**
 * @route GET /api/v1/admin/dashboard
 * @desc Get global admin dashboard statistics
 * @access Super Admin
 */
router.get('/dashboard', requireSuperAdmin, async (req, res, next) => {
  try {
    // Statistiques globales
    const [
      totalCompanies,
      activeCompanies,
      totalUsers,
      activeUsers,
      totalClients,
      totalInvoices,
      totalQuotes
    ] = await Promise.all([
      Company.count(),
      Company.count({ where: { created_at: { [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
      User.count(),
      User.count({ where: { is_active: true } }),
      Client.count(),
      Invoice.count(),
      Quote.count()
    ]);

    // Statistiques par rôle
    const usersByRole = await User.findAll({
      attributes: ['role', [User.sequelize.fn('COUNT', User.sequelize.col('id')), 'count']],
      group: ['role'],
      raw: true
    });

    // Statistiques par pays
    const companiesByCountry = await Company.findAll({
      attributes: ['country', [Company.sequelize.fn('COUNT', Company.sequelize.col('id')), 'count']],
      group: ['country'],
      raw: true
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalCompanies,
          activeCompanies,
          totalUsers,
          activeUsers,
          totalClients,
          totalInvoices,
          totalQuotes
        },
        usersByRole: usersByRole.reduce((acc, item) => {
          acc[item.role] = parseInt(item.count);
          return acc;
        }, {}),
        companiesByCountry: companiesByCountry.reduce((acc, item) => {
          acc[item.country] = parseInt(item.count);
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logger.error('Error fetching admin dashboard:', error);
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/companies
 * @desc Get all companies with pagination and filters
 * @access Super Admin
 */
router.get('/companies', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search;
    const country = req.query.country;

    let whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { business_number: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (country) {
      whereClause.country = country;
    }

    const { count, rows: companies } = await Company.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'users',
          attributes: ['id', 'email', 'role', 'is_active', 'last_login'],
          separate: true
        }
      ],
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    // Ajouter statistiques par company
    const companiesWithStats = await Promise.all(
      companies.map(async (company) => {
        const [clientCount, invoiceCount, quoteCount] = await Promise.all([
          Client.count({ where: { company_id: company.id } }),
          Invoice.count({ where: { company_id: company.id } }),
          Quote.count({ where: { company_id: company.id } })
        ]);

        return {
          ...company.toJSON(),
          stats: {
            clientCount,
            invoiceCount,
            quoteCount,
            userCount: company.users.length,
            activeUsers: company.users.filter(u => u.is_active).length
          }
        };
      })
    );

    res.json({
      success: true,
      data: {
        companies: companiesWithStats,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching companies:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/companies
 * @desc Create a new company
 * @access Super Admin
 */
router.post('/companies', requireSuperAdmin, async (req, res, next) => {
  try {
    // Validation
    const { error, value } = createCompanySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation error',
          details: error.details[0].message
        }
      });
    }

    // Vérifier unicité email
    const existingCompany = await Company.findOne({ where: { email: value.email } });
    if (existingCompany) {
      return res.status(409).json({
        success: false,
        error: {
          message: 'Email already exists',
          details: 'A company with this email already exists'
        }
      });
    }

    // Créer la company
    const company = await Company.create({
      name: value.name,
      country: value.country,
      email: value.email,
      business_number: value.businessNumber,
      vat_number: value.vatNumber,
      phone: value.phone,
      address: value.address || {},
      settings: value.settings || {}
    });

    logger.info(`Company created by super admin: ${company.id}`);

    res.status(201).json({
      success: true,
      data: { company },
      message: 'Company created successfully'
    });

  } catch (error) {
    logger.error('Error creating company:', error);
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/users
 * @desc Get all users across all companies with pagination and filters
 * @access Super Admin
 */
router.get('/users', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search;
    const role = req.query.role;
    const companyId = req.query.companyId;
    const isActive = req.query.isActive;

    let whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { email: { [Op.iLike]: `%${search}%` } },
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (role) {
      whereClause.role = role;
    }

    if (companyId) {
      whereClause.company_id = companyId;
    }

    if (isActive !== undefined) {
      whereClause.is_active = isActive === 'true';
    }

    const { count, rows: users } = await User.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'country', 'email']
        }
      ],
      attributes: { exclude: ['password_hash'] },
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching users:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/users
 * @desc Create a new user for any company
 * @access Super Admin
 */
router.post('/users', requireSuperAdmin, async (req, res, next) => {
  try {
    // Validation
    const { error, value } = createUserSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation error',
          details: error.details[0].message
        }
      });
    }

    // Vérifier que la company existe
    const company = await Company.findByPk(value.companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Company not found',
          details: 'The specified company does not exist'
        }
      });
    }

    // Vérifier unicité email
    const existingUser = await User.findOne({ where: { email: value.email } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: {
          message: 'Email already exists',
          details: 'A user with this email already exists'
        }
      });
    }

    // Créer l'utilisateur
    const user = await User.create({
      company_id: value.companyId,
      email: value.email,
      password_hash: value.password, // Sera hashé par le hook beforeCreate
      first_name: value.firstName,
      last_name: value.lastName,
      role: value.role,
      permissions: value.permissions || {},
      is_active: value.isActive !== undefined ? value.isActive : true
    });

    // Retourner sans le hash
    const userResponse = await User.findByPk(user.id, {
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'country']
        }
      ],
      attributes: { exclude: ['password_hash'] }
    });

    logger.info(`User created by super admin: ${user.id} for company: ${value.companyId}`);

    res.status(201).json({
      success: true,
      data: { user: userResponse },
      message: 'User created successfully'
    });

  } catch (error) {
    logger.error('Error creating user:', error);
    next(error);
  }
});

/**
 * @route PUT /api/v1/admin/users/:id
 * @desc Update user permissions and details
 * @access Super Admin
 */
router.put('/users/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const updates = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'User not found',
          details: 'The specified user does not exist'
        }
      });
    }

    // Mise à jour
    await user.update({
      role: updates.role || user.role,
      permissions: updates.permissions || user.permissions,
      is_active: updates.isActive !== undefined ? updates.isActive : user.is_active,
      first_name: updates.firstName || user.first_name,
      last_name: updates.lastName || user.last_name
    });

    // Retourner utilisateur mis à jour
    const updatedUser = await User.findByPk(userId, {
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'country']
        }
      ],
      attributes: { exclude: ['password_hash'] }
    });

    logger.info(`User updated by super admin: ${userId}`);

    res.json({
      success: true,
      data: { user: updatedUser },
      message: 'User updated successfully'
    });

  } catch (error) {
    logger.error('Error updating user:', error);
    next(error);
  }
});

/**
 * @route DELETE /api/v1/admin/companies/:id
 * @desc Delete/deactivate a company
 * @access Super Admin
 */
router.delete('/companies/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const companyId = req.params.id;
    const { permanent } = req.query;

    const company = await Company.findByPk(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Company not found',
          details: 'The specified company does not exist'
        }
      });
    }

    if (permanent === 'true') {
      // Suppression définitive (cascade sur users, clients, etc.)
      await company.destroy();
      logger.warn(`Company permanently deleted by super admin: ${companyId}`);

      res.json({
        success: true,
        message: 'Company permanently deleted'
      });
    } else {
      // Désactivation (soft delete)
      await company.update({
        settings: {
          ...company.settings,
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: req.user.id
        }
      });

      // Désactiver tous les utilisateurs
      await User.update(
        { is_active: false },
        { where: { company_id: companyId } }
      );

      logger.info(`Company deactivated by super admin: ${companyId}`);

      res.json({
        success: true,
        message: 'Company deactivated successfully'
      });
    }

  } catch (error) {
    logger.error('Error deleting/deactivating company:', error);
    next(error);
  }
});

module.exports = router;
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
const { validateQuery, validateParams, validateBody, schemas } = require('../utils/validationSchemas');

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
router.get('/companies', requireSuperAdmin, validateQuery(schemas.adminCompaniesQuery), async (req, res, next) => {
  try {
    const { page, limit, search, country } = req.query;
    const offset = (page - 1) * limit;

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
router.get('/users', requireSuperAdmin, validateQuery(schemas.adminUsersQuery), async (req, res, next) => {
  try {
    const { page, limit, search, role, companyId, isActive } = req.query;
    const offset = (page - 1) * limit;

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
router.put('/users/:id', requireSuperAdmin, validateParams(schemas.uuidParam), validateBody(schemas.adminUserUpdate), async (req, res, next) => {
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

    // Protéger les super_admin contre les modifications dangereuses
    if (user.role === 'super_admin') {
      // Vérifier si on essaie de changer le rôle ou de désactiver
      if (updates.role && updates.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Cannot modify super_admin role',
            details: 'Le rôle des comptes super_admin ne peut pas être modifié via l\'API. Les super_admin doivent être supprimés directement en base de données.',
            userId,
            email: user.email
          }
        });
      }

      if (updates.isActive === false) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Cannot deactivate super_admin account',
            details: 'Les comptes super_admin ne peuvent pas être désactivés via l\'API. Ils doivent être supprimés directement en base de données.',
            userId,
            email: user.email
          }
        });
      }
    }

    // Mise à jour (sécurisée pour les super_admin)
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
      // HARD DELETE: Suppression définitive (développement/test uniquement)
      // NOTE: Cette fonctionnalité sera supprimée en production
      const { Client: ClientModel } = require('../models');
      const sequelize = require('../config/database').sequelize;

      // Vérifier s'il y a des super_admin dans cette company
      const superAdmins = await User.findAll({
        where: {
          company_id: companyId,
          role: 'super_admin'
        }
      });

      if (superAdmins.length > 0) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Cannot delete company with super_admin users',
            details: `Cette company contient ${superAdmins.length} super_admin(s) et ne peut pas être supprimée. Les comptes super_admin peuvent uniquement être supprimés directement en base de données.`,
            superAdmins: superAdmins.map(u => ({ id: u.id, email: u.email }))
          }
        });
      }

      // Supprimer les données de la clinique
      await User.destroy({ where: { company_id: companyId } });
      await ClientModel.destroy({ where: { company_id: companyId } });
      await Invoice.destroy({ where: { company_id: companyId } });
      await Quote.destroy({ where: { company_id: companyId } });

      // Supprimer la company
      await company.destroy();

      logger.warn(`Company PERMANENTLY deleted by super admin: ${companyId}`);

      res.json({
        success: true,
        message: 'Company permanently deleted',
        data: {
          companyId,
          deletedAt: new Date()
        }
      });
    } else {
      // SOFT DELETE: Désactivation (production)
      // Vérifier s'il y a des super_admin dans cette company
      const superAdmins = await User.findAll({
        where: {
          company_id: companyId,
          role: 'super_admin'
        }
      });

      if (superAdmins.length > 0) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Cannot deactivate company with super_admin users',
            details: `Cette company contient ${superAdmins.length} super_admin(s) et ne peut pas être désactivée. Les comptes super_admin doivent être supprimés directement en base de données avant de désactiver la company.`,
            superAdmins: superAdmins.map(u => ({ id: u.id, email: u.email }))
          }
        });
      }

      await company.update({
        is_active: false,
        deleted_at: new Date()
      });

      // Désactiver tous les utilisateurs de la clinique
      await User.update(
        { is_active: false },
        { where: { company_id: companyId } }
      );

      logger.info(`Company deactivated by super admin: ${companyId}`);

      res.json({
        success: true,
        message: 'Company deactivated successfully',
        data: {
          companyId,
          status: 'inactive',
          deactivatedAt: company.deleted_at
        }
      });
    }

  } catch (error) {
    logger.error('Error deleting/deactivating company:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/companies/:id/reactivate
 * @desc Reactivate a deactivated company
 * @access Super Admin
 */
router.post('/companies/:id/reactivate', requireSuperAdmin, async (req, res, next) => {
  try {
    const companyId = req.params.id;

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

    // Réactiver la clinique
    await company.update({
      is_active: true,
      deleted_at: null
    });

    // Réactiver les utilisateurs (optionnel - l'admin peut décider)
    // await User.update(
    //   { is_active: true },
    //   { where: { company_id: companyId } }
    // );

    logger.info(`Company reactivated by super admin: ${companyId}`);

    res.json({
      success: true,
      message: 'Company reactivated successfully',
      data: {
        companyId,
        status: 'active',
        reactivatedAt: new Date()
      }
    });

  } catch (error) {
    logger.error('Error reactivating company:', error);
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/companies/:id/database-info
 * @desc Get database information for a specific clinic
 * @access Super Admin
 */
router.get('/companies/:id/database-info', requireSuperAdmin, async (req, res, next) => {
  try {
    const companyId = req.params.id;

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

    const dbName = `medicalpro_clinic_${companyId}`;

    // Informations sur la base de données
    const dbInfo = {
      databaseName: dbName,
      companyId,
      companyName: company.name,
      country: company.country,
      isActive: company.is_active,
      createdAt: company.created_at,
      deactivatedAt: company.deleted_at
    };

    res.json({
      success: true,
      data: {
        database: dbInfo
      }
    });

  } catch (error) {
    logger.error('Error fetching database info:', error);
    next(error);
  }
});

/**
 * @route DELETE /api/v1/admin/companies/:id/database-data
 * @desc Clear all data from a clinic database (keeping schema)
 * @access Super Admin
 */
router.delete('/companies/:id/database-data', requireSuperAdmin, async (req, res, next) => {
  try {
    const companyId = req.params.id;

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

    // Supprimer les données de la clinique (sans supprimer la company elle-même)
    const { Client: ClientModel } = require('../models');

    await Promise.all([
      User.destroy({ where: { company_id: companyId } }),
      ClientModel.destroy({ where: { company_id: companyId } }),
      Invoice.destroy({ where: { company_id: companyId } }),
      Quote.destroy({ where: { company_id: companyId } })
    ]);

    logger.info(`Database data cleared for company: ${companyId}`);

    res.json({
      success: true,
      message: 'Clinic database data cleared successfully',
      data: {
        companyId,
        clearedAt: new Date(),
        affectedTables: ['users', 'clients', 'invoices', 'quotes']
      }
    });

  } catch (error) {
    logger.error('Error clearing clinic database data:', error);
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/clinics/:id/check-integrity
 * @desc Check the integrity of a clinic database
 * @desc Verifies database exists, is accessible, and has all required tables
 * @access Super Admin
 */
router.get('/clinics/:id/check-integrity', requireSuperAdmin, async (req, res, next) => {
  try {
    const clinicId = req.params.id;

    // Verify company exists
    const company = await Company.findByPk(clinicId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Company not found',
          details: 'The specified company does not exist'
        }
      });
    }

    // Check clinic database integrity
    const clinicProvisioningService = require('../services/clinicProvisioningService');
    const integrity = await clinicProvisioningService.checkClinicDatabaseIntegrity(clinicId);

    logger.info(`Clinic database integrity check completed for: ${clinicId}`, {
      isHealthy: integrity.isHealthy,
      exists: integrity.exists,
      accessible: integrity.accessible
    });

    res.json({
      success: true,
      data: {
        clinicId,
        clinicName: company.name,
        integrity: {
          exists: integrity.exists,
          accessible: integrity.accessible,
          tablesCount: integrity.tablesCount,
          isHealthy: integrity.isHealthy,
          missingTables: integrity.missingTables || [],
          errors: integrity.errors || []
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error checking clinic database integrity:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/clinics/:id/repair
 * @desc Repair or recreate a broken clinic database
 * @desc Fixes incomplete databases, missing tables, or creates from scratch if needed
 * @access Super Admin
 */
router.post('/clinics/:id/repair', requireSuperAdmin, async (req, res, next) => {
  try {
    const clinicId = req.params.id;

    // Verify company exists
    const company = await Company.findByPk(clinicId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Company not found',
          details: 'The specified company does not exist'
        }
      });
    }

    logger.info(`Starting clinic database repair for: ${clinicId}`, {
      clinicName: company.name,
      country: company.country
    });

    // Check current integrity
    const clinicProvisioningService = require('../services/clinicProvisioningService');
    const initialIntegrity = await clinicProvisioningService.checkClinicDatabaseIntegrity(clinicId);

    if (initialIntegrity.isHealthy) {
      return res.json({
        success: true,
        message: 'Clinic database is already healthy - no repair needed',
        data: {
          clinicId,
          clinicName: company.name,
          integrity: initialIntegrity,
          repaired: false
        }
      });
    }

    // Attempt repair
    const repairResult = await clinicProvisioningService.repairClinicDatabase(
      clinicId,
      company.name,
      company.country
    );

    logger.info(`Clinic database repair completed for: ${clinicId}`, {
      success: repairResult.success
    });

    res.json({
      success: true,
      message: 'Clinic database repaired successfully',
      data: {
        clinicId,
        clinicName: company.name,
        beforeRepair: {
          exists: initialIntegrity.exists,
          accessible: initialIntegrity.accessible,
          tablesCount: initialIntegrity.tablesCount,
          missingTables: initialIntegrity.missingTables || []
        },
        afterRepair: {
          exists: repairResult.integrity?.exists || true,
          accessible: repairResult.integrity?.accessible || true,
          tablesCount: repairResult.integrity?.tablesCount || 0,
          isHealthy: repairResult.integrity?.isHealthy || true
        },
        repaired: true,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error repairing clinic database:', error);

    return res.status(500).json({
      success: false,
      error: {
        message: 'Failed to repair clinic database',
        details: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * @route GET /api/v1/admin/databases
 * @desc List all clinic databases with their status
 * @access Super Admin
 */
router.get('/databases', requireSuperAdmin, async (req, res, next) => {
  try {
    // Récupérer toutes les cliniques avec les infos de leurs bases
    const companies = await Company.findAll({
      attributes: ['id', 'name', 'country', 'created_at', 'updated_at'],
      raw: true,
      order: [['created_at', 'DESC']]
    });

    // Enrichir avec les infos de bases de données
    const databases = companies.map(company => ({
      databaseName: `medicalpro_clinic_${company.id}`,
      companyId: company.id,
      companyName: company.name,
      country: company.country,
      status: 'active',
      createdAt: company.created_at,
      deactivatedAt: null
    }));

    res.json({
      success: true,
      data: {
        databases,
        total: databases.length,
        active: databases.filter(d => d.status === 'active').length,
        inactive: databases.filter(d => d.status === 'inactive').length
      }
    });

  } catch (error) {
    logger.error('Error listing databases:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/services/control
 * @desc Control services (stop/restart Mailhog, Frontend, etc.)
 * @access Super Admin
 */
router.post('/services/control', requireSuperAdmin, async (req, res, next) => {
  try {
    const { action, service } = req.body;

    if (!action || !service) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Missing parameters',
          details: 'action and service parameters are required'
        }
      });
    }

    const validActions = ['stop', 'restart'];
    const validServices = ['mailhog', 'frontend'];

    if (!validActions.includes(action) || !validServices.includes(service)) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid parameters',
          details: 'action must be "stop" or "restart", service must be "mailhog" or "frontend"'
        }
      });
    }

    const { spawn, exec } = require('child_process');
    let result = null;

    if (service === 'mailhog') {
      if (action === 'stop') {
        exec('pkill -f "mailhog"', (error) => {
          if (error && error.code !== 0) {
            logger.warn('Mailhog might not have been running');
          }
        });
        result = { service: 'mailhog', action: 'stop', timestamp: new Date() };
      } else if (action === 'restart') {
        exec('pkill -f "mailhog"', (error) => {
          setTimeout(() => {
            spawn('mailhog', [], { detached: true, stdio: 'ignore' }).unref();
            logger.info('Mailhog restarted');
          }, 1000);
        });
        result = { service: 'mailhog', action: 'restart', timestamp: new Date() };
      }
    } else if (service === 'frontend') {
      if (action === 'stop') {
        exec('pkill -f "medical-pro.*npm start" || pkill -P $(lsof -t -i :3000 2>/dev/null) 2>/dev/null', (error) => {
          logger.info('Frontend stop signal sent');
        });
        result = { service: 'frontend', action: 'stop', timestamp: new Date() };
      } else if (action === 'restart') {
        exec('pkill -f "medical-pro.*npm start" || pkill -P $(lsof -t -i :3000 2>/dev/null) 2>/dev/null', (error) => {
          setTimeout(() => {
            spawn('bash', ['-c', 'cd /var/www/medical-pro && PORT=3000 npm start > /tmp/frontend.log 2>&1'], {
              detached: true,
              stdio: 'ignore'
            }).unref();
            logger.info('Frontend restarted');
          }, 1000);
        });
        result = { service: 'frontend', action: 'restart', timestamp: new Date() };
      }
    }

    logger.info(`Service control action: ${action} on ${service}`);

    res.json({
      success: true,
      data: {
        result,
        message: `${service} ${action} initiated successfully`
      }
    });

  } catch (error) {
    logger.error('Error controlling services:', error);
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/services-health
 * @desc Check health status of all services (Backend, Frontend, Mailhog, Databases)
 * @access Super Admin
 */
router.get('/services-health', requireSuperAdmin, async (req, res, next) => {
  try {
    const startTime = Date.now();
    const healthStatus = {
      timestamp: new Date().toISOString(),
      services: {}
    };

    // Check Backend API (self)
    healthStatus.services.backend = {
      name: 'Backend API',
      port: 3001,
      status: 'running',
      responseTime: Date.now() - startTime,
      url: 'http://localhost:3001'
    };

    // Check Frontend (React App)
    try {
      const frontendStart = Date.now();
      const frontendResponse = await fetch('http://localhost:3000', { timeout: 5000 });
      healthStatus.services.frontend = {
        name: 'Frontend Clinic',
        port: 3000,
        status: frontendResponse.ok ? 'running' : 'error',
        responseTime: Date.now() - frontendStart,
        statusCode: frontendResponse.status,
        url: 'http://localhost:3000'
      };
    } catch (error) {
      healthStatus.services.frontend = {
        name: 'Frontend Clinic',
        port: 3000,
        status: 'unavailable',
        error: error.message,
        url: 'http://localhost:3000'
      };
    }

    // Check Mailhog
    try {
      const mailhogStart = Date.now();
      const mailhogResponse = await fetch('http://localhost:8025', { timeout: 5000 });
      healthStatus.services.mailhog = {
        name: 'Mailhog Email Service',
        port: 8025,
        status: mailhogResponse.ok ? 'running' : 'error',
        responseTime: Date.now() - mailhogStart,
        statusCode: mailhogResponse.status,
        url: 'http://localhost:8025'
      };
    } catch (error) {
      healthStatus.services.mailhog = {
        name: 'Mailhog Email Service',
        port: 8025,
        status: 'unavailable',
        error: error.message,
        url: 'http://localhost:8025'
      };
    }

    // Check Central Database
    try {
      const dbStart = Date.now();
      const { getCentralConnection } = require('../config/connectionManager');
      const central = getCentralConnection();
      await central.authenticate();
      healthStatus.services.centralDatabase = {
        name: 'Central Database',
        database: 'medicalpro_central',
        status: 'running',
        responseTime: Date.now() - dbStart
      };
    } catch (error) {
      healthStatus.services.centralDatabase = {
        name: 'Central Database',
        database: 'medicalpro_central',
        status: 'unavailable',
        error: error.message
      };
    }

    // Count clinic databases
    try {
      const companies = await Company.count();
      healthStatus.services.clinicDatabases = {
        name: 'Clinic Databases',
        status: 'running',
        activeCount: companies
      };
    } catch (error) {
      healthStatus.services.clinicDatabases = {
        name: 'Clinic Databases',
        status: 'unavailable',
        error: error.message
      };
    }

    // Calculate overall status
    const serviceStatuses = Object.values(healthStatus.services).map(s => s.status);
    const hasError = serviceStatuses.includes('unavailable') || serviceStatuses.includes('error');
    healthStatus.overallStatus = hasError ? 'degraded' : 'healthy';

    res.json({
      success: true,
      data: healthStatus
    });

  } catch (error) {
    logger.error('Error checking services health:', error);
    next(error);
  }
});

module.exports = router;
/**
 * Users Routes - Clinic User Management
 * CRUD operations for clinic users (company-scoped)
 *
 * These routes operate on the central database but are scoped to the user's company.
 * Super admins can access users across all companies via the admin routes.
 */

const express = require('express');
const Joi = require('joi');
const { Op } = require('sequelize');
const { User, Company } = require('../models');
const { logger } = require('../utils/logger');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { PERMISSIONS } = require('../utils/permissionConstants');
const { validateQuery, validateParams, validateBody, schemas } = require('../utils/validationSchemas');

const router = express.Router();

// Validation schemas
// Central users are company owners and clinic admins
// Professional fields (phone, department, speciality, licenseNumber) belong to healthcare_providers, not central users
const createUserSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  firstName: Joi.string().max(100).optional(),
  lastName: Joi.string().max(100).optional(),
  role: Joi.string().valid('admin', 'physician', 'practitioner', 'secretary', 'readonly').required(),
  permissions: Joi.object().optional(),
  isActive: Joi.boolean().default(true)
});

const updateUserSchema = Joi.object({
  email: Joi.string().email().optional(),
  password: Joi.string().min(8).optional(),
  firstName: Joi.string().max(100).optional(),
  lastName: Joi.string().max(100).optional(),
  role: Joi.string().valid('admin', 'physician', 'practitioner', 'secretary', 'readonly').optional(),
  permissions: Joi.object().optional(),
  isActive: Joi.boolean().optional()
}).min(1);

const usersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().allow('').max(255).optional(),
  role: Joi.string().valid('admin', 'physician', 'practitioner', 'secretary', 'readonly').optional(),
  isActive: Joi.string().valid('true', 'false').optional()
});

/**
 * @route GET /api/v1/users
 * @desc Get all users for the current company (clinic)
 * @access Private - Requires USERS_VIEW permission
 */
router.get('/',
  authMiddleware,
  requirePermission(PERMISSIONS.USERS_VIEW),
  validateQuery(usersQuerySchema),
  async (req, res, next) => {
    try {
      const { page, limit, search, role, department, isActive } = req.query;
      const offset = (page - 1) * limit;
      const companyId = req.user.companyId;

      // Build where clause
      const where = { company_id: companyId };

      if (search) {
        where[Op.or] = [
          { email: { [Op.iLike]: `%${search}%` } },
          { first_name: { [Op.iLike]: `%${search}%` } },
          { last_name: { [Op.iLike]: `%${search}%` } }
        ];
      }

      if (role) {
        where.role = role;
      }

      if (isActive !== undefined) {
        where.is_active = isActive === 'true';
      }

      const { count, rows } = await User.findAndCountAll({
        where,
        attributes: { exclude: ['password_hash', 'email_verification_token'] },
        order: [['created_at', 'DESC']],
        limit,
        offset
      });

      // Transform to frontend format
      const users = rows.map(user => user.toSafeJSON());

      res.json({
        success: true,
        data: users,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      });
    } catch (error) {
      logger.error('[users] GET / error:', error);
      next(error);
    }
  }
);

/**
 * @route GET /api/v1/users/stats
 * @desc Get user statistics for the current company
 * @access Private - Requires USERS_VIEW permission
 */
router.get('/stats',
  authMiddleware,
  requirePermission(PERMISSIONS.USERS_VIEW),
  async (req, res, next) => {
    try {
      const companyId = req.user.companyId;

      const [
        totalUsers,
        activeUsers,
        usersByRole
      ] = await Promise.all([
        User.count({ where: { company_id: companyId } }),
        User.count({ where: { company_id: companyId, is_active: true } }),
        User.findAll({
          where: { company_id: companyId },
          attributes: ['role', [User.sequelize.fn('COUNT', User.sequelize.col('id')), 'count']],
          group: ['role'],
          raw: true
        })
      ]);

      // Get recent logins (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentLogins = await User.count({
        where: {
          company_id: companyId,
          last_login: { [Op.gte]: sevenDaysAgo }
        }
      });

      res.json({
        success: true,
        data: {
          total: totalUsers,
          active: activeUsers,
          inactive: totalUsers - activeUsers,
          recentLogins,
          byRole: usersByRole.reduce((acc, item) => {
            acc[item.role] = parseInt(item.count);
            return acc;
          }, {})
        }
      });
    } catch (error) {
      logger.error('[users] GET /stats error:', error);
      next(error);
    }
  }
);

/**
 * @route GET /api/v1/users/:id
 * @desc Get a single user by ID
 * @access Private - Requires USERS_VIEW permission
 */
router.get('/:id',
  authMiddleware,
  requirePermission(PERMISSIONS.USERS_VIEW),
  validateParams(schemas.uuidParam),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const companyId = req.user.companyId;

      const user = await User.findOne({
        where: { id, company_id: companyId },
        attributes: { exclude: ['password_hash', 'email_verification_token'] }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: { message: 'Utilisateur non trouvé' }
        });
      }

      res.json({
        success: true,
        data: user.toSafeJSON()
      });
    } catch (error) {
      logger.error('[users] GET /:id error:', error);
      next(error);
    }
  }
);

/**
 * @route POST /api/v1/users
 * @desc Create a new user for the current company
 * @access Private - Requires USERS_CREATE permission
 */
router.post('/',
  authMiddleware,
  requirePermission(PERMISSIONS.USERS_CREATE),
  validateBody(createUserSchema),
  async (req, res, next) => {
    try {
      const companyId = req.user.companyId;
      const {
        email,
        password,
        firstName,
        lastName,
        role,
        phone,
        department,
        speciality,
        licenseNumber,
        permissions,
        isActive
      } = req.body;

      // Check if email already exists
      const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: { message: 'Un utilisateur avec cet email existe déjà' }
        });
      }

      // Prevent creating super_admin via this route
      if (role === 'super_admin') {
        return res.status(403).json({
          success: false,
          error: { message: 'Impossible de créer un super_admin via cette route' }
        });
      }

      // Create user
      const user = await User.create({
        company_id: companyId,
        email: email.toLowerCase(),
        password_hash: password, // Will be hashed by hook
        first_name: firstName,
        last_name: lastName,
        role,
        permissions: permissions || {},
        is_active: isActive !== false
      });

      logger.info(`[users] User created: ${user.email}`, {
        userId: user.id,
        companyId,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        data: user.toSafeJSON(),
        message: 'Utilisateur créé avec succès'
      });
    } catch (error) {
      logger.error('[users] POST / error:', error);
      next(error);
    }
  }
);

/**
 * @route PUT /api/v1/users/:id
 * @desc Update a user
 * @access Private - Requires USERS_EDIT permission
 */
router.put('/:id',
  authMiddleware,
  requirePermission(PERMISSIONS.USERS_EDIT),
  validateParams(schemas.uuidParam),
  validateBody(updateUserSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const companyId = req.user.companyId;
      const updates = req.body;

      const user = await User.findOne({
        where: { id, company_id: companyId }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: { message: 'Utilisateur non trouvé' }
        });
      }

      // Prevent modifying super_admin
      if (user.role === 'super_admin') {
        return res.status(403).json({
          success: false,
          error: { message: 'Impossible de modifier un super_admin' }
        });
      }

      // Prevent promoting to super_admin
      if (updates.role === 'super_admin') {
        return res.status(403).json({
          success: false,
          error: { message: 'Impossible de promouvoir en super_admin' }
        });
      }

      // Check email uniqueness if changing
      if (updates.email && updates.email.toLowerCase() !== user.email) {
        const existingUser = await User.findOne({
          where: { email: updates.email.toLowerCase() }
        });
        if (existingUser) {
          return res.status(409).json({
            success: false,
            error: { message: 'Un utilisateur avec cet email existe déjà' }
          });
        }
      }

      // Build update object
      const updateData = {};
      if (updates.email) updateData.email = updates.email.toLowerCase();
      if (updates.password) updateData.password_hash = updates.password;
      if (updates.firstName !== undefined) updateData.first_name = updates.firstName;
      if (updates.lastName !== undefined) updateData.last_name = updates.lastName;
      if (updates.role) updateData.role = updates.role;
      if (updates.permissions) updateData.permissions = updates.permissions;
      if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

      await user.update(updateData);

      logger.info(`[users] User updated: ${user.email}`, {
        userId: user.id,
        companyId,
        updatedBy: req.user.userId
      });

      // Fetch updated user without password
      const updatedUser = await User.findByPk(id, {
        attributes: { exclude: ['password_hash', 'email_verification_token'] }
      });

      res.json({
        success: true,
        data: updatedUser.toSafeJSON(),
        message: 'Utilisateur mis à jour avec succès'
      });
    } catch (error) {
      logger.error('[users] PUT /:id error:', error);
      next(error);
    }
  }
);

/**
 * @route DELETE /api/v1/users/:id
 * @desc Delete a user (soft delete - sets is_active to false)
 * @access Private - Requires USERS_DELETE permission
 */
router.delete('/:id',
  authMiddleware,
  requirePermission(PERMISSIONS.USERS_DELETE),
  validateParams(schemas.uuidParam),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const companyId = req.user.companyId;

      const user = await User.findOne({
        where: { id, company_id: companyId }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: { message: 'Utilisateur non trouvé' }
        });
      }

      // Prevent deleting super_admin
      if (user.role === 'super_admin') {
        return res.status(403).json({
          success: false,
          error: { message: 'Impossible de supprimer un super_admin' }
        });
      }

      // Prevent self-deletion
      if (id === req.user.userId) {
        return res.status(403).json({
          success: false,
          error: { message: 'Vous ne pouvez pas vous supprimer vous-même' }
        });
      }

      // Soft delete
      await user.update({ is_active: false });

      logger.info(`[users] User deleted (soft): ${user.email}`, {
        userId: user.id,
        companyId,
        deletedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Utilisateur désactivé avec succès'
      });
    } catch (error) {
      logger.error('[users] DELETE /:id error:', error);
      next(error);
    }
  }
);

/**
 * @route POST /api/v1/users/:id/restore
 * @desc Restore a soft-deleted user
 * @access Private - Requires USERS_EDIT permission
 */
router.post('/:id/restore',
  authMiddleware,
  requirePermission(PERMISSIONS.USERS_EDIT),
  validateParams(schemas.uuidParam),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const companyId = req.user.companyId;

      const user = await User.findOne({
        where: { id, company_id: companyId }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: { message: 'Utilisateur non trouvé' }
        });
      }

      if (user.is_active) {
        return res.status(400).json({
          success: false,
          error: { message: 'Cet utilisateur est déjà actif' }
        });
      }

      await user.update({ is_active: true });

      logger.info(`[users] User restored: ${user.email}`, {
        userId: user.id,
        companyId,
        restoredBy: req.user.userId
      });

      res.json({
        success: true,
        data: user.toSafeJSON(),
        message: 'Utilisateur restauré avec succès'
      });
    } catch (error) {
      logger.error('[users] POST /:id/restore error:', error);
      next(error);
    }
  }
);

/**
 * @route POST /api/v1/users/:id/reset-password
 * @desc Admin reset password for a user
 * @access Private - Requires USERS_EDIT permission
 */
router.post('/:id/reset-password',
  authMiddleware,
  requirePermission(PERMISSIONS.USERS_EDIT),
  validateParams(schemas.uuidParam),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;
      const companyId = req.user.companyId;

      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: { message: 'Le nouveau mot de passe doit contenir au moins 8 caractères' }
        });
      }

      const user = await User.findOne({
        where: { id, company_id: companyId }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: { message: 'Utilisateur non trouvé' }
        });
      }

      // Prevent resetting super_admin password
      if (user.role === 'super_admin') {
        return res.status(403).json({
          success: false,
          error: { message: 'Impossible de réinitialiser le mot de passe d\'un super_admin' }
        });
      }

      await user.update({ password_hash: newPassword });

      logger.info(`[users] Password reset for: ${user.email}`, {
        userId: user.id,
        companyId,
        resetBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Mot de passe réinitialisé avec succès'
      });
    } catch (error) {
      logger.error('[users] POST /:id/reset-password error:', error);
      next(error);
    }
  }
);

module.exports = router;

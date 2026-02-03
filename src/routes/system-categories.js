/**
 * System Categories Routes
 * CRUD operations for dynamic system categories (consent types, appointment types, specialties, departments)
 */

const express = require('express');
const Joi = require('joi');
const { getModel } = require('../base/ModelFactory');
const { requirePermission } = require('../middleware/permissions');
const { logger } = require('../utils/logger');

const router = express.Router();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const CATEGORY_TYPES = ['consent_type', 'appointment_type', 'specialty', 'department', 'priority'];

const translationSchema = Joi.object({
  name: Joi.string().max(100).required(),
  description: Joi.string().max(500).allow('', null)
});

const translationsSchema = Joi.object({
  es: translationSchema,
  en: translationSchema,
  fr: translationSchema
}).min(1);

const createSchema = Joi.object({
  code: Joi.string().pattern(/^[a-z][a-z0-9_]*$/i).min(1).max(50).required(),
  categoryType: Joi.string().valid(...CATEGORY_TYPES).required(),
  translations: translationsSchema.required(),
  metadata: Joi.object().default({}),
  sortOrder: Joi.number().integer().min(0).default(0),
  isActive: Joi.boolean().default(true)
});

const updateSchema = Joi.object({
  code: Joi.string().pattern(/^[a-z][a-z0-9_]*$/i).min(1).max(50),
  translations: translationsSchema,
  metadata: Joi.object(),
  sortOrder: Joi.number().integer().min(0),
  isActive: Joi.boolean()
}).min(1);

const querySchema = Joi.object({
  type: Joi.string().valid(...CATEGORY_TYPES),
  includeInactive: Joi.boolean().default(false),
  search: Joi.string().max(100),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(100)
});

const reorderSchema = Joi.object({
  type: Joi.string().valid(...CATEGORY_TYPES).required(),
  orderedIds: Joi.array().items(Joi.string().uuid()).min(1).required()
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Transform category for API response
 */
const transformCategory = (category, lang = 'es') => {
  if (!category) return null;

  const data = category.toJSON ? category.toJSON() : category;

  return {
    id: data.id,
    code: data.code,
    categoryType: data.category_type,
    name: data.translations?.[lang]?.name || data.translations?.es?.name || data.code,
    description: data.translations?.[lang]?.description || data.translations?.es?.description || '',
    translations: data.translations,
    metadata: data.metadata,
    sortOrder: data.sort_order,
    isActive: data.is_active,
    isSystem: data.is_system,
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
};

/**
 * Get language from request (header or query)
 */
const getLanguage = (req) => {
  return req.query.lang || req.headers['accept-language']?.split(',')[0]?.substring(0, 2) || 'es';
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /system-categories
 * List categories with optional filtering
 */
router.get('/',
  async (req, res) => {
    try {
      const { error, value } = querySchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const { type, includeInactive, search, page, limit } = value;
      const lang = getLanguage(req);

      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      // Build where clause
      const where = {};

      if (type) {
        where.category_type = type;
      }

      if (!includeInactive) {
        where.is_active = true;
      }

      // Search across translations
      if (search) {
        const { Op } = require('sequelize');
        const searchPattern = `%${search.toLowerCase()}%`;
        where[Op.or] = [
          req.clinicDb.literal(`translations->'es'->>'name' ILIKE '${searchPattern}'`),
          req.clinicDb.literal(`translations->'en'->>'name' ILIKE '${searchPattern}'`),
          req.clinicDb.literal(`translations->'fr'->>'name' ILIKE '${searchPattern}'`),
          { code: { [Op.iLike]: `%${search}%` } }
        ];
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await SystemCategory.findAndCountAll({
        where,
        order: [['category_type', 'ASC'], ['sort_order', 'ASC'], ['code', 'ASC']],
        limit,
        offset
      });

      res.json({
        success: true,
        data: rows.map(cat => transformCategory(cat, lang)),
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit),
          hasNextPage: page < Math.ceil(count / limit),
          hasPrevPage: page > 1
        }
      });
    } catch (error) {
      logger.error('Error fetching system categories:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /system-categories/types
 * Get list of available category types
 */
router.get('/types',
  async (req, res) => {
    try {
      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      res.json({
        success: true,
        data: SystemCategory.getAvailableTypes()
      });
    } catch (error) {
      logger.error('Error fetching category types:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /system-categories/by-type/:type
 * Get categories by type (convenience endpoint)
 */
router.get('/by-type/:type',
  async (req, res) => {
    try {
      const { type } = req.params;

      if (!CATEGORY_TYPES.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid category type. Must be one of: ${CATEGORY_TYPES.join(', ')}`
        });
      }

      const includeInactive = req.query.includeInactive === 'true';
      const lang = getLanguage(req);

      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      const categories = await SystemCategory.findByType(type, { includeInactive });

      res.json({
        success: true,
        data: categories.map(cat => transformCategory(cat, lang))
      });
    } catch (error) {
      logger.error('Error fetching categories by type:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /system-categories/grouped
 * Get all categories grouped by type
 */
router.get('/grouped',
  async (req, res) => {
    try {
      const lang = getLanguage(req);
      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      const grouped = await SystemCategory.findAllGroupedByType();

      // Transform each category in each group
      const transformedGrouped = {};
      for (const [type, categories] of Object.entries(grouped)) {
        transformedGrouped[type] = categories.map(cat => transformCategory(cat, lang));
      }

      res.json({
        success: true,
        data: transformedGrouped
      });
    } catch (error) {
      logger.error('Error fetching grouped categories:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /system-categories/:id
 * Get a single category by ID
 */
router.get('/:id',
  async (req, res) => {
    try {
      const { id } = req.params;
      const lang = getLanguage(req);

      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      const category = await SystemCategory.findByPk(id);

      if (!category) {
        return res.status(404).json({
          success: false,
          error: 'Category not found'
        });
      }

      res.json({
        success: true,
        data: transformCategory(category, lang)
      });
    } catch (error) {
      logger.error('Error fetching category:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /system-categories
 * Create a new category (admin only)
 */
router.post('/',
  requirePermission('admin.settings'),
  async (req, res) => {
    try {
      const { error, value } = createSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const lang = getLanguage(req);
      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      // Check for duplicate code within type
      const existing = await SystemCategory.findByTypeAndCode(value.categoryType, value.code);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: `A category with code '${value.code}' already exists for type '${value.categoryType}'`
        });
      }

      // Create the category
      const category = await SystemCategory.create({
        code: value.code,
        category_type: value.categoryType,
        translations: value.translations,
        metadata: value.metadata,
        sort_order: value.sortOrder,
        is_active: value.isActive,
        is_system: false // User-created categories are never system
      });

      logger.info('System category created', {
        categoryId: category.id,
        code: category.code,
        type: category.category_type,
        userId: req.user?.id
      });

      res.status(201).json({
        success: true,
        data: transformCategory(category, lang),
        message: 'Category created successfully'
      });
    } catch (error) {
      logger.error('Error creating category:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * PUT /system-categories/:id
 * Update a category (admin only)
 */
router.put('/:id',
  requirePermission('admin.settings'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { error, value } = updateSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const lang = getLanguage(req);
      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      const category = await SystemCategory.findByPk(id);
      if (!category) {
        return res.status(404).json({
          success: false,
          error: 'Category not found'
        });
      }

      // Check for code uniqueness if changing code
      if (value.code && value.code !== category.code) {
        const existing = await SystemCategory.findByTypeAndCode(category.category_type, value.code);
        if (existing) {
          return res.status(409).json({
            success: false,
            error: `A category with code '${value.code}' already exists for type '${category.category_type}'`
          });
        }
      }

      // Build update data
      const updateData = {};
      if (value.code) updateData.code = value.code;
      if (value.translations) updateData.translations = value.translations;
      if (value.metadata !== undefined) updateData.metadata = value.metadata;
      if (value.sortOrder !== undefined) updateData.sort_order = value.sortOrder;
      if (value.isActive !== undefined) updateData.is_active = value.isActive;

      await category.update(updateData);

      logger.info('System category updated', {
        categoryId: category.id,
        code: category.code,
        type: category.category_type,
        userId: req.user?.id
      });

      res.json({
        success: true,
        data: transformCategory(category, lang),
        message: 'Category updated successfully'
      });
    } catch (error) {
      logger.error('Error updating category:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * DELETE /system-categories/:id
 * Delete a category (admin only, system categories cannot be deleted)
 */
router.delete('/:id',
  requirePermission('admin.settings'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      const category = await SystemCategory.findByPk(id);
      if (!category) {
        return res.status(404).json({
          success: false,
          error: 'Category not found'
        });
      }

      // Prevent deletion of system categories
      if (category.is_system) {
        return res.status(403).json({
          success: false,
          error: 'System categories cannot be deleted'
        });
      }

      // Store data for logging
      const categoryData = {
        id: category.id,
        code: category.code,
        type: category.category_type
      };

      await category.destroy();

      logger.info('System category deleted', {
        ...categoryData,
        userId: req.user?.id
      });

      res.json({
        success: true,
        message: 'Category deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting category:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /system-categories/reorder
 * Reorder categories within a type (admin only)
 */
router.post('/reorder',
  requirePermission('admin.settings'),
  async (req, res) => {
    try {
      const { error, value } = reorderSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const { type, orderedIds } = value;
      const lang = getLanguage(req);

      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      const updatedCount = await SystemCategory.reorder(type, orderedIds);

      // Fetch updated categories
      const categories = await SystemCategory.findByType(type);

      logger.info('System categories reordered', {
        type,
        count: updatedCount,
        userId: req.user?.id
      });

      res.json({
        success: true,
        data: categories.map(cat => transformCategory(cat, lang)),
        message: `${updatedCount} categories reordered successfully`
      });
    } catch (error) {
      logger.error('Error reordering categories:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /system-categories/validate/:type/:code
 * Validate if a code exists for a type
 */
router.get('/validate/:type/:code',
  async (req, res) => {
    try {
      const { type, code } = req.params;

      if (!CATEGORY_TYPES.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid category type. Must be one of: ${CATEGORY_TYPES.join(', ')}`
        });
      }

      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      const isValid = await SystemCategory.isValidCode(type, code);

      res.json({
        success: true,
        data: {
          type,
          code,
          isValid
        }
      });
    } catch (error) {
      logger.error('Error validating category code:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /system-categories/codes/:type
 * Get all codes for a type (useful for validation/select options)
 */
router.get('/codes/:type',
  async (req, res) => {
    try {
      const { type } = req.params;

      if (!CATEGORY_TYPES.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid category type. Must be one of: ${CATEGORY_TYPES.join(', ')}`
        });
      }

      const SystemCategory = await getModel(req.clinicDb, 'SystemCategory');

      const codes = await SystemCategory.getCodesByType(type);

      res.json({
        success: true,
        data: codes
      });
    } catch (error) {
      logger.error('Error fetching category codes:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

module.exports = router;

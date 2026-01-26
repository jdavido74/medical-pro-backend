/**
 * Categories Routes - Clinic Isolated
 * CRUD operations for product categories with clinic-specific database isolation
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const { getModel } = require('../base/ModelFactory');
const { Op } = require('sequelize');

const router = express.Router();

const createSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().allow('', null).optional(),
  color: Joi.string().pattern(/^#[0-9A-F]{6}$/i).default('#3B82F6'),
  type: Joi.string().valid('product', 'medication', 'treatment', 'service', 'appointment', 'other').default('product'),
  sortOrder: Joi.number().integer().min(0).default(0),
  isActive: Joi.boolean().default(true)
});

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  description: Joi.string().allow('', null).optional(),
  color: Joi.string().pattern(/^#[0-9A-F]{6}$/i).optional(),
  type: Joi.string().valid('product', 'medication', 'treatment', 'service', 'appointment', 'other').optional(),
  sortOrder: Joi.number().integer().min(0).optional(),
  isActive: Joi.boolean().optional()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(100),
  search: Joi.string().optional(),
  type: Joi.string().valid('product', 'medication', 'treatment', 'service', 'appointment', 'other').optional(),
  isActive: Joi.boolean().optional()
});

// Field mapping from camelCase to snake_case
const fieldMapping = {
  sortOrder: 'sort_order',
  isActive: 'is_active',
  companyId: 'company_id'
};

// Transform camelCase to snake_case for database
const transformToDb = (data) => {
  const transformed = {};
  for (const [key, value] of Object.entries(data)) {
    const dbKey = fieldMapping[key] || key;
    transformed[dbKey] = value;
  }
  return transformed;
};

// Transform snake_case to camelCase for API response
const transformFromDb = (item) => {
  if (!item) return null;
  const data = item.toJSON ? item.toJSON() : item;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    color: data.color,
    type: data.type,
    sortOrder: data.sort_order,
    isActive: data.is_active,
    companyId: data.company_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    // Include product count if loaded
    productsCount: data.products ? data.products.length : undefined
  };
};

// ============================================
// SPECIFIC ROUTES - Must be defined BEFORE CRUD routes
// ============================================

/**
 * GET /categories/by-type/:type - Get categories by type
 */
router.get('/by-type/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const Category = await getModel(req.clinicDb, 'Category');

    const categories = await Category.findAll({
      where: {
        type,
        is_active: true
      },
      order: [['sort_order', 'ASC'], ['name', 'ASC']]
    });

    res.json({
      success: true,
      data: categories.map(transformFromDb)
    });
  } catch (error) {
    console.error('[categories] Error fetching by type:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch categories' }
    });
  }
});

/**
 * GET /categories/grouped - Get all categories grouped by type
 */
router.get('/grouped', async (req, res) => {
  try {
    const Category = await getModel(req.clinicDb, 'Category');

    const categories = await Category.findAll({
      where: { is_active: true },
      order: [['type', 'ASC'], ['sort_order', 'ASC'], ['name', 'ASC']]
    });

    // Group by type
    const grouped = {};
    categories.forEach(cat => {
      const transformed = transformFromDb(cat);
      if (!grouped[transformed.type]) {
        grouped[transformed.type] = [];
      }
      grouped[transformed.type].push(transformed);
    });

    res.json({
      success: true,
      data: grouped
    });
  } catch (error) {
    console.error('[categories] Error fetching grouped:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch categories' }
    });
  }
});

/**
 * POST /categories/reorder - Reorder categories
 */
router.post('/reorder', async (req, res) => {
  try {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({
        success: false,
        error: { message: 'orderedIds must be an array' }
      });
    }

    const Category = await getModel(req.clinicDb, 'Category');

    // Update sort_order for each category
    await Promise.all(
      orderedIds.map((id, index) =>
        Category.update(
          { sort_order: index },
          { where: { id } }
        )
      )
    );

    res.json({
      success: true,
      message: 'Categories reordered successfully'
    });
  } catch (error) {
    console.error('[categories] Error reordering:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to reorder categories' }
    });
  }
});

/**
 * GET /categories/:id/products - Get products count for a category
 */
router.get('/:id/products', async (req, res) => {
  try {
    const { id } = req.params;
    const Category = await getModel(req.clinicDb, 'Category');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const category = await Category.findByPk(id, {
      include: [{
        model: ProductService,
        as: 'products',
        attributes: ['id', 'title', 'item_type', 'is_active']
      }]
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: { message: 'Category not found' }
      });
    }

    res.json({
      success: true,
      data: {
        category: transformFromDb(category),
        products: category.products || [],
        count: category.products ? category.products.length : 0
      }
    });
  } catch (error) {
    console.error('[categories] Error fetching products:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch category products' }
    });
  }
});

// ============================================
// CRUD ROUTES - Generic routes with /:id pattern
// ============================================

// Basic CRUD routes using clinic-aware factory
const categoryRoutes = clinicCrudRoutes('Category', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'Category',
  searchFields: ['name', 'description'],

  onBeforeCreate: async (data, user, clinicDb) => {
    const dbData = transformToDb(data);

    // Add company_id from authenticated user
    dbData.company_id = user.companyId;

    // Validate name uniqueness per clinic and type
    const Category = await getModel(clinicDb, 'Category');
    const existing = await Category.findOne({
      where: {
        name: dbData.name,
        type: dbData.type || 'product',
        company_id: user.companyId
      }
    });
    if (existing) {
      throw new Error('Category name already exists for this type');
    }
    return dbData;
  },

  onBeforeUpdate: async (data, user, clinicDb, existingItem) => {
    return transformToDb(data);
  },

  transformResponse: (item) => transformFromDb(item),

  // Custom query building
  buildQuery: (query, queryParams) => {
    if (queryParams.type) {
      query.where = query.where || {};
      query.where.type = queryParams.type;
    }
    // Order by sort_order then name
    query.order = [['sort_order', 'ASC'], ['name', 'ASC']];
    return query;
  }
});

router.use('/', categoryRoutes);

module.exports = router;

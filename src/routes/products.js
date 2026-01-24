/**
 * Products/Services Routes - Clinic Isolated
 * CRUD operations for medical products/services with clinic-specific database isolation
 * Supports medications, treatments, services with medical-specific attributes
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const { getModel } = require('../base/ModelFactory');
const { Op } = require('sequelize');

const router = express.Router();

// Validation schemas
const createSchema = Joi.object({
  // Basic fields
  title: Joi.string().min(2).max(200).required(),
  description: Joi.string().allow('', null).optional(),
  type: Joi.string().valid('product', 'service').required(),
  itemType: Joi.string().valid('product', 'medication', 'treatment', 'service').default('product'),

  // Pricing
  unitPrice: Joi.number().min(0).max(999999.99).required(),
  currency: Joi.string().length(3).default('EUR'),
  unit: Joi.string().max(50).default('unité'),
  sku: Joi.string().max(100).allow('', null).optional(),
  taxRate: Joi.number().min(0).max(100).default(20.00),

  // Status
  isActive: Joi.boolean().default(true),

  // Categories
  categories: Joi.array().items(Joi.string().uuid()).optional(),

  // Medical-specific fields
  duration: Joi.number().integer().min(5).max(480).allow(null).optional(),
  prepBefore: Joi.number().integer().min(0).max(120).default(0),
  prepAfter: Joi.number().integer().min(0).max(120).default(0),
  dosage: Joi.number().min(0).allow(null).optional(),
  dosageUnit: Joi.string().valid('mg', 'ml', 'g', 'ui', 'mcg').allow(null).optional(),
  volume: Joi.number().min(0).allow(null).optional(),
  provenance: Joi.string().max(200).allow('', null).optional(),

  // Planning fields
  isOverlappable: Joi.boolean().default(false),
  machineTypeId: Joi.string().uuid().allow(null).optional(),

  // Family/Variant fields
  parentId: Joi.string().uuid().allow(null).optional(),
  isFamily: Joi.boolean().default(false),
  isVariant: Joi.boolean().default(false)
});

const updateSchema = Joi.object({
  title: Joi.string().min(2).max(200).optional(),
  description: Joi.string().allow('', null).optional(),
  type: Joi.string().valid('product', 'service').optional(),
  itemType: Joi.string().valid('product', 'medication', 'treatment', 'service').optional(),
  unitPrice: Joi.number().min(0).max(999999.99).optional(),
  currency: Joi.string().length(3).optional(),
  unit: Joi.string().max(50).optional(),
  sku: Joi.string().max(100).allow('', null).optional(),
  taxRate: Joi.number().min(0).max(100).optional(),
  isActive: Joi.boolean().optional(),
  categories: Joi.array().items(Joi.string().uuid()).optional(),
  duration: Joi.number().integer().min(5).max(480).allow(null).optional(),
  prepBefore: Joi.number().integer().min(0).max(120).optional(),
  prepAfter: Joi.number().integer().min(0).max(120).optional(),
  dosage: Joi.number().min(0).allow(null).optional(),
  dosageUnit: Joi.string().valid('mg', 'ml', 'g', 'ui', 'mcg').allow(null).optional(),
  volume: Joi.number().min(0).allow(null).optional(),
  provenance: Joi.string().max(200).allow('', null).optional(),
  isOverlappable: Joi.boolean().optional(),
  machineTypeId: Joi.string().uuid().allow(null).optional(),
  parentId: Joi.string().uuid().allow(null).optional(),
  isFamily: Joi.boolean().optional(),
  isVariant: Joi.boolean().optional()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  search: Joi.string().optional(),
  type: Joi.string().valid('product', 'service').optional(),
  itemType: Joi.string().valid('product', 'medication', 'treatment', 'service').optional(),
  isActive: Joi.boolean().optional(),
  isFamily: Joi.boolean().optional(),
  isVariant: Joi.boolean().optional(),
  parentId: Joi.string().uuid().optional(),
  includeVariants: Joi.boolean().default(false)
});

// Field mapping from camelCase to snake_case
const fieldMapping = {
  itemType: 'item_type',
  unitPrice: 'unit_price',
  taxRate: 'tax_rate',
  isActive: 'is_active',
  prepBefore: 'prep_before',
  prepAfter: 'prep_after',
  dosageUnit: 'dosage_unit',
  isOverlappable: 'is_overlappable',
  machineTypeId: 'machine_type_id',
  parentId: 'parent_id',
  isFamily: 'is_family',
  isVariant: 'is_variant'
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
    title: data.title,
    description: data.description,
    type: data.type,
    itemType: data.item_type,
    unitPrice: parseFloat(data.unit_price),
    currency: data.currency,
    unit: data.unit,
    sku: data.sku,
    taxRate: parseFloat(data.tax_rate),
    isActive: data.is_active,
    duration: data.duration,
    prepBefore: data.prep_before,
    prepAfter: data.prep_after,
    dosage: data.dosage ? parseFloat(data.dosage) : null,
    dosageUnit: data.dosage_unit,
    volume: data.volume ? parseFloat(data.volume) : null,
    provenance: data.provenance,
    isOverlappable: data.is_overlappable,
    machineTypeId: data.machine_type_id,
    parentId: data.parent_id,
    isFamily: data.is_family,
    isVariant: data.is_variant,
    companyId: data.company_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    // Include variants if loaded
    variants: data.variants ? data.variants.map(transformFromDb) : undefined,
    parent: data.parent ? transformFromDb(data.parent) : undefined,
    categories: data.categories || undefined
  };
};

// Basic CRUD routes using clinic-aware factory
const productRoutes = clinicCrudRoutes('ProductService', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'Catalog Item',
  searchFields: ['title', 'description', 'sku', 'provenance'],

  // Transform data before create
  onBeforeCreate: async (data, user, clinicDb) => {
    // Transform camelCase to snake_case
    const dbData = transformToDb(data);

    // Validate SKU uniqueness per clinic
    if (dbData.sku) {
      const ProductService = await getModel(clinicDb, 'ProductService');
      const existing = await ProductService.findOne({
        where: { sku: dbData.sku }
      });
      if (existing) {
        throw new Error('SKU already exists in this clinic');
      }
    }

    // Set type based on item_type for backwards compatibility
    if (dbData.item_type === 'service') {
      dbData.type = 'service';
    } else {
      dbData.type = 'product';
    }

    return dbData;
  },

  // Transform data before update
  onBeforeUpdate: async (data, user, clinicDb, existingItem) => {
    const dbData = transformToDb(data);

    // Update type based on item_type
    if (dbData.item_type) {
      dbData.type = dbData.item_type === 'service' ? 'service' : 'product';
    }

    return dbData;
  },

  // Transform response after fetch
  transformResponse: (item) => transformFromDb(item)
});

router.use('/', productRoutes);

// === Custom endpoints ===

/**
 * GET /catalog/families - Get all family items with their variants
 */
router.get('/families', async (req, res) => {
  try {
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const families = await ProductService.findAll({
      where: {
        is_family: true,
        is_active: true
      },
      include: [{
        model: ProductService,
        as: 'variants',
        where: { is_active: true },
        required: false
      }],
      order: [['title', 'ASC']]
    });

    res.json({
      success: true,
      data: families.map(transformFromDb)
    });
  } catch (error) {
    console.error('[products] Error fetching families:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch families' }
    });
  }
});

/**
 * POST /:id/variants - Add a variant to a family
 */
router.post('/:id/variants', async (req, res) => {
  try {
    const { id } = req.params;
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    // Find parent
    const parent = await ProductService.findByPk(id);
    if (!parent) {
      return res.status(404).json({
        success: false,
        error: { message: 'Parent item not found' }
      });
    }

    // Validate variant data
    const { error, value } = createSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    // Create variant
    const variantData = transformToDb(value);
    variantData.parent_id = id;
    variantData.is_variant = true;
    variantData.is_family = false;
    variantData.type = parent.type;
    variantData.item_type = parent.item_type;
    variantData.company_id = req.user.companyId;

    // Inherit some fields from parent if not provided
    if (!variantData.provenance) variantData.provenance = parent.provenance;
    if (!variantData.tax_rate) variantData.tax_rate = parent.tax_rate;

    const variant = await ProductService.create(variantData);

    // Mark parent as family if not already
    if (!parent.is_family) {
      await parent.update({ is_family: true });
    }

    res.status(201).json({
      success: true,
      data: transformFromDb(variant)
    });
  } catch (error) {
    console.error('[products] Error creating variant:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create variant' }
    });
  }
});

/**
 * POST /:id/duplicate - Duplicate an item
 */
router.post('/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params;
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const original = await ProductService.findByPk(id);
    if (!original) {
      return res.status(404).json({
        success: false,
        error: { message: 'Item not found' }
      });
    }

    // Create duplicate
    const duplicateData = original.toJSON();
    delete duplicateData.id;
    delete duplicateData.created_at;
    delete duplicateData.updated_at;
    duplicateData.title = `${duplicateData.title} (copie)`;
    duplicateData.sku = duplicateData.sku ? `${duplicateData.sku}-COPY` : null;
    duplicateData.is_family = false;
    duplicateData.is_variant = false;
    duplicateData.parent_id = null;

    const duplicate = await ProductService.create(duplicateData);

    res.status(201).json({
      success: true,
      data: transformFromDb(duplicate)
    });
  } catch (error) {
    console.error('[products] Error duplicating item:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to duplicate item' }
    });
  }
});

/**
 * GET /catalog/stats - Get catalog statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const [total, active, medications, treatments, services, families, variants] = await Promise.all([
      ProductService.count(),
      ProductService.count({ where: { is_active: true } }),
      ProductService.count({ where: { item_type: 'medication', is_active: true } }),
      ProductService.count({ where: { item_type: 'treatment', is_active: true } }),
      ProductService.count({ where: { item_type: 'service', is_active: true } }),
      ProductService.count({ where: { is_family: true, is_active: true } }),
      ProductService.count({ where: { is_variant: true, is_active: true } })
    ]);

    res.json({
      success: true,
      data: {
        total,
        active,
        inactive: total - active,
        byType: {
          medications,
          treatments,
          services,
          products: active - medications - treatments - services
        },
        families,
        variants
      }
    });
  } catch (error) {
    console.error('[products] Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch statistics' }
    });
  }
});

/**
 * GET /catalog/for-appointments - Get items that impact appointments
 */
router.get('/for-appointments', async (req, res) => {
  try {
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const items = await ProductService.findAll({
      where: {
        is_active: true,
        item_type: { [Op.in]: ['service', 'treatment'] },
        duration: { [Op.ne]: null }
      },
      order: [['item_type', 'ASC'], ['title', 'ASC']]
    });

    res.json({
      success: true,
      data: items.map(item => ({
        id: item.id,
        title: item.title,
        itemType: item.item_type,
        duration: item.duration,
        prepBefore: item.prep_before,
        prepAfter: item.prep_after,
        totalDuration: (item.prep_before || 0) + item.duration + (item.prep_after || 0),
        unitPrice: parseFloat(item.unit_price),
        isOverlappable: item.is_overlappable,
        machineTypeId: item.machine_type_id
      }))
    });
  } catch (error) {
    console.error('[products] Error fetching items for appointments:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch items' }
    });
  }
});

module.exports = router;

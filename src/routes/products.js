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
  limit: Joi.number().integer().min(1).max(1000).default(100),
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
    // Include variants if loaded (legacy)
    variants: data.variants ? data.variants.map(transformFromDb) : undefined,
    parent: data.parent ? transformFromDb(data.parent) : undefined,
    categories: data.categories || undefined,
    // Include tags
    tags: data.tags ? data.tags.map(tag => ({
      id: tag.id,
      name: tag.name,
      color: tag.color
    })) : undefined
  };
};

// === Custom endpoints that don't use :id (MUST be before CRUD routes) ===

/**
 * GET /families - Get all family items with their variants
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
 * GET /stats - Get catalog statistics
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
 * GET /for-appointments - Get items that impact appointments
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

// Basic CRUD routes using clinic-aware factory
const productRoutes = clinicCrudRoutes('ProductService', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'Catalog Item',
  searchFields: ['title', 'description', 'sku', 'provenance'],
  // Query params that are not DB columns
  excludeFromFilters: ['includeVariants'],

  // Transform data before create
  onBeforeCreate: async (data, user, clinicDb) => {
    // Transform camelCase to snake_case
    const dbData = transformToDb(data);

    // Add company_id from authenticated user
    dbData.company_id = user.companyId;

    // Extract categories for later association
    let categoryIds = data.categories || [];
    delete dbData.categories;

    // Handle variant inheritance from parent
    if (dbData.parent_id) {
      const ProductService = await getModel(clinicDb, 'ProductService');
      const parent = await ProductService.findByPk(dbData.parent_id);

      if (parent) {
        // Mark as variant
        dbData.is_variant = true;
        dbData.is_family = false;

        // Inherit type from parent
        dbData.type = parent.type;
        dbData.item_type = parent.item_type;

        // Inherit description if not provided
        if (!dbData.description) {
          dbData.description = parent.description;
        }

        // Inherit provenance if not provided
        if (!dbData.provenance) {
          dbData.provenance = parent.provenance;
        }

        // Inherit tax rate if not provided
        if (!dbData.tax_rate && parent.tax_rate) {
          dbData.tax_rate = parent.tax_rate;
        }

        // Inherit category from parent if not provided
        if (categoryIds.length === 0) {
          // Get parent's categories
          const parentCategories = await parent.getCategories();
          if (parentCategories && parentCategories.length > 0) {
            categoryIds = parentCategories.map(c => c.id);
          }
        }

        // Mark parent as family if not already
        if (!parent.is_family) {
          await parent.update({ is_family: true });
        }
      }
    }

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

    // Set type based on item_type for backwards compatibility (only if not inherited)
    if (!dbData.parent_id) {
      if (dbData.item_type === 'service') {
        dbData.type = 'service';
      } else {
        dbData.type = 'product';
      }
    }

    // Store categoryIds for onAfterCreate
    dbData._categoryIds = categoryIds;

    return dbData;
  },

  // Handle category association after create
  onAfterCreate: async (item, data, user, clinicDb) => {
    const categoryIds = data._categoryIds || [];
    if (categoryIds.length > 0) {
      try {
        const Category = await getModel(clinicDb, 'Category');
        const categories = await Category.findAll({
          where: { id: categoryIds }
        });
        if (categories.length > 0) {
          await item.setCategories(categories);
        }
      } catch (error) {
        console.error('[products] Error setting categories:', error);
      }
    }
    return item;
  },

  // Transform data before update
  // Note: clinicCrudRoutes calls onBeforeUpdate(data, existingItem, user, clinicDb)
  onBeforeUpdate: async (data, existingItem, user, clinicDb) => {
    const dbData = transformToDb(data);

    // Handle category update
    if (data.categories !== undefined) {
      const categoryIds = data.categories || [];
      delete dbData.categories;

      try {
        const Category = await getModel(clinicDb, 'Category');
        const categories = await Category.findAll({
          where: { id: categoryIds }
        });
        await existingItem.setCategories(categories);
      } catch (error) {
        console.error('[products] Error updating categories:', error);
      }
    }

    // Update type based on item_type
    if (dbData.item_type) {
      dbData.type = dbData.item_type === 'service' ? 'service' : 'product';
    }

    return dbData;
  },

  // Include categories when building query
  buildQuery: async (query, queryParams, clinicDb) => {
    try {
      // Ensure ProductService is loaded first to set up associations
      const ProductService = await getModel(clinicDb, 'ProductService');
      const Category = await getModel(clinicDb, 'Category');

      query.include = query.include || [];

      // Add category include
      query.include.push({
        model: Category,
        as: 'categories',
        through: { attributes: [] },
        attributes: ['id', 'name', 'color', 'type'],
        required: false
      });

      // Add tag include only if association exists
      try {
        const Tag = await getModel(clinicDb, 'Tag');
        if (ProductService.associations?.tags) {
          query.include.push({
            model: Tag,
            as: 'tags',
            through: { attributes: [] },
            attributes: ['id', 'name', 'color'],
            required: false
          });
        }
      } catch (tagErr) {
        console.warn('[products] Could not include tags:', tagErr.message);
      }
    } catch (err) {
      console.error('[products] Error in buildQuery:', err.message);
    }

    return query;
  },

  // Transform response after fetch
  transformResponse: (item) => transformFromDb(item)
});

router.use('/', productRoutes);

// === Custom endpoints with :id parameter (after CRUD routes is OK) ===

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

    // Inherit fields from parent if not provided
    if (!variantData.provenance) variantData.provenance = parent.provenance;
    if (!variantData.tax_rate) variantData.tax_rate = parent.tax_rate;
    if (!variantData.description) variantData.description = parent.description;

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

    // If original is a variant, keep it as a variant in the same family
    // If original is a family, duplicate becomes a standalone item (not a family)
    // If original is standalone, duplicate stays standalone
    if (original.is_variant && original.parent_id) {
      // Keep as variant in the same family
      duplicateData.is_family = false;
      duplicateData.is_variant = true;
      // parent_id is already set from original.toJSON()
    } else {
      // Standalone item (family becomes standalone, standalone stays standalone)
      duplicateData.is_family = false;
      duplicateData.is_variant = false;
      duplicateData.parent_id = null;
    }

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
 * GET /:id/tags - Get tags for a product
 */
router.get('/:id/tags', async (req, res) => {
  try {
    const { id } = req.params;
    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const Tag = await getModel(req.clinicDb, 'Tag');

    const product = await ProductService.findByPk(id, {
      include: [{
        model: Tag,
        as: 'tags',
        through: { attributes: [] }
      }]
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: { message: 'Product not found' }
      });
    }

    res.json({
      success: true,
      data: product.tags?.map(tag => ({
        id: tag.id,
        name: tag.name,
        color: tag.color
      })) || []
    });
  } catch (error) {
    console.error('[products] Error fetching product tags:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch product tags' }
    });
  }
});

/**
 * POST /:id/tags - Add tags to a product
 */
router.post('/:id/tags', async (req, res) => {
  try {
    const { id } = req.params;
    const { tagIds } = req.body;

    if (!Array.isArray(tagIds)) {
      return res.status(400).json({
        success: false,
        error: { message: 'tagIds must be an array' }
      });
    }

    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const Tag = await getModel(req.clinicDb, 'Tag');

    const product = await ProductService.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { message: 'Product not found' }
      });
    }

    // Verify all tags exist
    const tags = await Tag.findAll({ where: { id: tagIds } });
    if (tags.length !== tagIds.length) {
      return res.status(400).json({
        success: false,
        error: { message: 'One or more tags not found' }
      });
    }

    // Add tags (addTags handles duplicates)
    await product.addTags(tags);

    // Fetch updated tags
    const updatedProduct = await ProductService.findByPk(id, {
      include: [{
        model: Tag,
        as: 'tags',
        through: { attributes: [] }
      }]
    });

    res.json({
      success: true,
      data: updatedProduct.tags?.map(tag => ({
        id: tag.id,
        name: tag.name,
        color: tag.color
      })) || []
    });
  } catch (error) {
    console.error('[products] Error adding tags:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to add tags' }
    });
  }
});

/**
 * PUT /:id/tags - Replace all tags for a product
 */
router.put('/:id/tags', async (req, res) => {
  try {
    const { id } = req.params;
    const { tagIds } = req.body;

    if (!Array.isArray(tagIds)) {
      return res.status(400).json({
        success: false,
        error: { message: 'tagIds must be an array' }
      });
    }

    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const Tag = await getModel(req.clinicDb, 'Tag');

    const product = await ProductService.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { message: 'Product not found' }
      });
    }

    // Verify all tags exist
    const tags = await Tag.findAll({ where: { id: tagIds } });
    if (tags.length !== tagIds.length) {
      return res.status(400).json({
        success: false,
        error: { message: 'One or more tags not found' }
      });
    }

    // Replace all tags
    await product.setTags(tags);

    res.json({
      success: true,
      data: tags.map(tag => ({
        id: tag.id,
        name: tag.name,
        color: tag.color
      }))
    });
  } catch (error) {
    console.error('[products] Error setting tags:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to set tags' }
    });
  }
});

/**
 * DELETE /:id/tags/:tagId - Remove a tag from a product
 */
router.delete('/:id/tags/:tagId', async (req, res) => {
  try {
    const { id, tagId } = req.params;
    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const Tag = await getModel(req.clinicDb, 'Tag');

    const product = await ProductService.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { message: 'Product not found' }
      });
    }

    const tag = await Tag.findByPk(tagId);
    if (!tag) {
      return res.status(404).json({
        success: false,
        error: { message: 'Tag not found' }
      });
    }

    await product.removeTag(tag);

    res.json({
      success: true,
      message: 'Tag removed from product'
    });
  } catch (error) {
    console.error('[products] Error removing tag:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to remove tag' }
    });
  }
});

// ============================================
// SUPPLIER ENDPOINTS
// ============================================

/**
 * GET /:id/suppliers - Get suppliers for a product
 */
router.get('/:id/suppliers', async (req, res) => {
  try {
    const { id } = req.params;
    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const ProductSupplier = await getModel(req.clinicDb, 'ProductSupplier');
    const Supplier = await getModel(req.clinicDb, 'Supplier');
    const { transformProductSupplierToApi } = require('../models/ProductSupplier');
    const { transformSupplierToApi } = require('../models/Supplier');

    const product = await ProductService.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { message: 'Product not found' }
      });
    }

    // Get suppliers for this product
    const productSuppliers = await ProductSupplier.findAll({
      where: { product_id: id },
      include: [{
        model: Supplier,
        as: 'supplier'
      }],
      order: [['is_primary', 'DESC'], ['created_at', 'ASC']]
    });

    // If product is a variant, also get inherited suppliers from parent
    let inheritedSuppliers = [];
    if (product.parent_id) {
      const parentSuppliers = await ProductSupplier.findAll({
        where: { product_id: product.parent_id },
        include: [{
          model: Supplier,
          as: 'supplier'
        }],
        order: [['is_primary', 'DESC'], ['created_at', 'ASC']]
      });
      inheritedSuppliers = parentSuppliers.map(ps => ({
        ...transformProductSupplierToApi(ps),
        isInherited: true
      }));
    }

    res.json({
      success: true,
      data: {
        suppliers: productSuppliers.map(ps => ({
          ...transformProductSupplierToApi(ps),
          isInherited: false
        })),
        inheritedSuppliers
      }
    });
  } catch (error) {
    console.error('[products] Error getting product suppliers:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get product suppliers' }
    });
  }
});

/**
 * POST /:id/suppliers - Add a supplier to a product
 */
router.post('/:id/suppliers', async (req, res) => {
  try {
    const { id } = req.params;
    const { supplierId, isPrimary, supplierSku, unitCost, currency, minOrderQuantity, leadTimeDays, notes } = req.body;

    if (!supplierId) {
      return res.status(400).json({
        success: false,
        error: { message: 'supplierId is required' }
      });
    }

    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const ProductSupplier = await getModel(req.clinicDb, 'ProductSupplier');
    const Supplier = await getModel(req.clinicDb, 'Supplier');
    const { transformProductSupplierToApi } = require('../models/ProductSupplier');

    const product = await ProductService.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { message: 'Product not found' }
      });
    }

    const supplier = await Supplier.findOne({
      where: { id: supplierId, company_id: req.user.companyId }
    });
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: { message: 'Supplier not found' }
      });
    }

    // Check if association already exists
    const existing = await ProductSupplier.findOne({
      where: { product_id: id, supplier_id: supplierId }
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { message: 'Supplier is already associated with this product' }
      });
    }

    // If setting as primary, unset other primaries
    if (isPrimary) {
      await ProductSupplier.update(
        { is_primary: false },
        { where: { product_id: id } }
      );
    }

    const productSupplier = await ProductSupplier.create({
      product_id: id,
      supplier_id: supplierId,
      is_primary: isPrimary || false,
      supplier_sku: supplierSku,
      unit_cost: unitCost,
      currency: currency || 'EUR',
      min_order_quantity: minOrderQuantity,
      lead_time_days: leadTimeDays,
      notes
    });

    // Reload with supplier
    await productSupplier.reload({
      include: [{ model: Supplier, as: 'supplier' }]
    });

    res.status(201).json({
      success: true,
      data: transformProductSupplierToApi(productSupplier),
      message: 'Supplier added to product'
    });
  } catch (error) {
    console.error('[products] Error adding supplier to product:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to add supplier to product' }
    });
  }
});

/**
 * PUT /:id/suppliers/:supplierId - Update product-supplier relationship
 */
router.put('/:id/suppliers/:supplierId', async (req, res) => {
  try {
    const { id, supplierId } = req.params;
    const { isPrimary, supplierSku, unitCost, currency, minOrderQuantity, leadTimeDays, notes } = req.body;

    const ProductSupplier = await getModel(req.clinicDb, 'ProductSupplier');
    const Supplier = await getModel(req.clinicDb, 'Supplier');
    const { transformProductSupplierToApi } = require('../models/ProductSupplier');

    const productSupplier = await ProductSupplier.findOne({
      where: { product_id: id, supplier_id: supplierId }
    });

    if (!productSupplier) {
      return res.status(404).json({
        success: false,
        error: { message: 'Product-supplier relationship not found' }
      });
    }

    // If setting as primary, unset other primaries
    if (isPrimary === true) {
      await ProductSupplier.update(
        { is_primary: false },
        { where: { product_id: id, supplier_id: { [Op.ne]: supplierId } } }
      );
    }

    await productSupplier.update({
      is_primary: isPrimary !== undefined ? isPrimary : productSupplier.is_primary,
      supplier_sku: supplierSku !== undefined ? supplierSku : productSupplier.supplier_sku,
      unit_cost: unitCost !== undefined ? unitCost : productSupplier.unit_cost,
      currency: currency !== undefined ? currency : productSupplier.currency,
      min_order_quantity: minOrderQuantity !== undefined ? minOrderQuantity : productSupplier.min_order_quantity,
      lead_time_days: leadTimeDays !== undefined ? leadTimeDays : productSupplier.lead_time_days,
      notes: notes !== undefined ? notes : productSupplier.notes
    });

    // Reload with supplier
    await productSupplier.reload({
      include: [{ model: Supplier, as: 'supplier' }]
    });

    res.json({
      success: true,
      data: transformProductSupplierToApi(productSupplier),
      message: 'Product-supplier relationship updated'
    });
  } catch (error) {
    console.error('[products] Error updating product supplier:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update product supplier' }
    });
  }
});

/**
 * DELETE /:id/suppliers/:supplierId - Remove a supplier from a product
 */
router.delete('/:id/suppliers/:supplierId', async (req, res) => {
  try {
    const { id, supplierId } = req.params;

    const ProductSupplier = await getModel(req.clinicDb, 'ProductSupplier');

    const productSupplier = await ProductSupplier.findOne({
      where: { product_id: id, supplier_id: supplierId }
    });

    if (!productSupplier) {
      return res.status(404).json({
        success: false,
        error: { message: 'Product-supplier relationship not found' }
      });
    }

    await productSupplier.destroy();

    res.json({
      success: true,
      message: 'Supplier removed from product'
    });
  } catch (error) {
    console.error('[products] Error removing supplier from product:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to remove supplier from product' }
    });
  }
});

/**
 * PUT /:id/suppliers/:supplierId/primary - Set a supplier as primary
 */
router.put('/:id/suppliers/:supplierId/primary', async (req, res) => {
  try {
    const { id, supplierId } = req.params;

    const ProductSupplier = await getModel(req.clinicDb, 'ProductSupplier');
    const Supplier = await getModel(req.clinicDb, 'Supplier');
    const { transformProductSupplierToApi } = require('../models/ProductSupplier');

    const productSupplier = await ProductSupplier.findOne({
      where: { product_id: id, supplier_id: supplierId }
    });

    if (!productSupplier) {
      return res.status(404).json({
        success: false,
        error: { message: 'Product-supplier relationship not found' }
      });
    }

    // Unset all other primaries for this product
    await ProductSupplier.update(
      { is_primary: false },
      { where: { product_id: id } }
    );

    // Set this one as primary
    await productSupplier.update({ is_primary: true });

    // Reload with supplier
    await productSupplier.reload({
      include: [{ model: Supplier, as: 'supplier' }]
    });

    res.json({
      success: true,
      data: transformProductSupplierToApi(productSupplier),
      message: 'Supplier set as primary'
    });
  } catch (error) {
    console.error('[products] Error setting primary supplier:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to set primary supplier' }
    });
  }
});

module.exports = router;

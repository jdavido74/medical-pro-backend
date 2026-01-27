/**
 * Suppliers Routes
 * CRUD operations for suppliers management
 * Reusable across the application
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { Op } = require('sequelize');
const { getModel } = require('../base/ModelFactory');
const { transformSupplierToDb, transformSupplierToApi } = require('../models/Supplier');
const { transformProductSupplierToApi } = require('../models/ProductSupplier');

// ============================================
// VALIDATION SCHEMAS
// ============================================

const createSupplierSchema = Joi.object({
  name: Joi.string().max(200).required(),
  // Address
  addressLine1: Joi.string().max(255).allow('', null).optional(),
  addressLine2: Joi.string().max(255).allow('', null).optional(),
  city: Joi.string().max(100).allow('', null).optional(),
  postalCode: Joi.string().max(20).allow('', null).optional(),
  state: Joi.string().max(100).allow('', null).optional(),
  country: Joi.string().max(100).allow('', null).optional(),
  countryCode: Joi.string().length(2).uppercase().allow('', null).optional(),
  // Contact
  phone: Joi.string().max(50).allow('', null).optional(),
  email: Joi.string().email().allow('', null).optional(),
  website: Joi.string().max(255).allow('', null).optional(),
  // Contact person
  contactName: Joi.string().max(200).allow('', null).optional(),
  contactEmail: Joi.string().email().allow('', null).optional(),
  contactPhone: Joi.string().max(50).allow('', null).optional(),
  // Additional
  notes: Joi.string().allow('', null).optional(),
  taxId: Joi.string().max(50).allow('', null).optional(),
  isActive: Joi.boolean().default(true)
});

const updateSupplierSchema = createSupplierSchema.fork(
  ['name'],
  (schema) => schema.optional()
);

const listSuppliersSchema = Joi.object({
  search: Joi.string().allow('').optional(),
  isActive: Joi.boolean().optional(),
  country: Joi.string().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  sortBy: Joi.string().valid('name', 'city', 'country', 'created_at').default('name'),
  sortOrder: Joi.string().valid('ASC', 'DESC').default('ASC')
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /suppliers - List all suppliers
 */
router.get('/', async (req, res) => {
  try {
    const { error, value } = listSuppliersSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const { search, isActive, country, page, limit, sortBy, sortOrder } = value;
    const Supplier = await getModel(req.clinicDb, 'Supplier');

    // Build where clause
    const where = {
      company_id: req.user.companyId
    };

    if (isActive !== undefined) {
      where.is_active = isActive;
    }

    if (country) {
      where.country_code = country.toUpperCase();
    }

    if (search) {
      const searchTerm = `%${search}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: searchTerm } },
        { email: { [Op.iLike]: searchTerm } },
        { contact_name: { [Op.iLike]: searchTerm } },
        { city: { [Op.iLike]: searchTerm } }
      ];
    }

    const { count, rows } = await Supplier.findAndCountAll({
      where,
      order: [[sortBy === 'created_at' ? 'created_at' : sortBy, sortOrder]],
      limit,
      offset: (page - 1) * limit
    });

    res.json({
      success: true,
      data: {
        suppliers: rows.map(transformSupplierToApi),
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil(count / limit)
        }
      }
    });
  } catch (error) {
    console.error('[suppliers] Error listing suppliers:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to list suppliers' }
    });
  }
});

/**
 * GET /suppliers/search - Quick search for autocomplete
 */
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const Supplier = await getModel(req.clinicDb, 'Supplier');
    const suppliers = await Supplier.search(req.user.companyId, q, { limit: parseInt(limit) });

    res.json({
      success: true,
      data: suppliers.map(s => ({
        id: s.id,
        name: s.name,
        city: s.city,
        country: s.country,
        countryCode: s.country_code
      }))
    });
  } catch (error) {
    console.error('[suppliers] Error searching suppliers:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Search failed' }
    });
  }
});

/**
 * GET /suppliers/:id - Get supplier details
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const Supplier = await getModel(req.clinicDb, 'Supplier');

    const supplier = await Supplier.findOne({
      where: {
        id,
        company_id: req.user.companyId
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: { message: 'Supplier not found' }
      });
    }

    res.json({
      success: true,
      data: transformSupplierToApi(supplier)
    });
  } catch (error) {
    console.error('[suppliers] Error getting supplier:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get supplier' }
    });
  }
});

/**
 * POST /suppliers - Create a new supplier
 */
router.post('/', async (req, res) => {
  try {
    const { error, value } = createSupplierSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const Supplier = await getModel(req.clinicDb, 'Supplier');

    // Transform to DB format and add company_id
    const dbData = transformSupplierToDb(value);
    dbData.company_id = req.user.companyId;

    const supplier = await Supplier.create(dbData);

    res.status(201).json({
      success: true,
      data: transformSupplierToApi(supplier),
      message: 'Supplier created successfully'
    });
  } catch (error) {
    console.error('[suppliers] Error creating supplier:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create supplier' }
    });
  }
});

/**
 * PUT /suppliers/:id - Update a supplier
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error, value } = updateSupplierSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const Supplier = await getModel(req.clinicDb, 'Supplier');

    const supplier = await Supplier.findOne({
      where: {
        id,
        company_id: req.user.companyId
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: { message: 'Supplier not found' }
      });
    }

    // Transform and update
    const dbData = transformSupplierToDb(value);
    await supplier.update(dbData);

    res.json({
      success: true,
      data: transformSupplierToApi(supplier),
      message: 'Supplier updated successfully'
    });
  } catch (error) {
    console.error('[suppliers] Error updating supplier:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update supplier' }
    });
  }
});

/**
 * DELETE /suppliers/:id - Delete a supplier (soft delete by deactivating)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query;

    const Supplier = await getModel(req.clinicDb, 'Supplier');

    const supplier = await Supplier.findOne({
      where: {
        id,
        company_id: req.user.companyId
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: { message: 'Supplier not found' }
      });
    }

    if (permanent === 'true') {
      // Hard delete
      await supplier.destroy();
      res.json({
        success: true,
        message: 'Supplier permanently deleted'
      });
    } else {
      // Soft delete (deactivate)
      await supplier.update({ is_active: false });
      res.json({
        success: true,
        message: 'Supplier deactivated'
      });
    }
  } catch (error) {
    console.error('[suppliers] Error deleting supplier:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete supplier' }
    });
  }
});

/**
 * GET /suppliers/:id/products - Get products for a supplier
 */
router.get('/:id/products', async (req, res) => {
  try {
    const { id } = req.params;
    const ProductSupplier = await getModel(req.clinicDb, 'ProductSupplier');
    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const Supplier = await getModel(req.clinicDb, 'Supplier');

    // Verify supplier exists and belongs to company
    const supplier = await Supplier.findOne({
      where: { id, company_id: req.user.companyId }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: { message: 'Supplier not found' }
      });
    }

    const productSuppliers = await ProductSupplier.findAll({
      where: { supplier_id: id },
      include: [{
        model: ProductService,
        as: 'product',
        attributes: ['id', 'title', 'item_type', 'sku', 'unit_price']
      }],
      order: [['is_primary', 'DESC'], ['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: productSuppliers.map(transformProductSupplierToApi)
    });
  } catch (error) {
    console.error('[suppliers] Error getting supplier products:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get supplier products' }
    });
  }
});

module.exports = router;

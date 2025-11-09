/**
 * Products/Services Routes - Clinic Isolated
 * CRUD operations for medical products/services with clinic-specific database isolation
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const { getModel } = require('../base/ModelFactory');
const { Op } = require('sequelize');

const router = express.Router();

const createSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional(),
  type: Joi.string().valid('product', 'service').required(),
  unitPrice: Joi.number().required(),
  currency: Joi.string().default('EUR'),
  unit: Joi.string().default('unité'),
  sku: Joi.string().optional(),
  taxRate: Joi.number().default(20.00),
  isActive: Joi.boolean().default(true),
  categories: Joi.array().items(Joi.string().uuid()).optional()
});

const updateSchema = createSchema.optional();

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().optional(),
  type: Joi.string().valid('product', 'service').optional(),
  isActive: Joi.boolean().optional()
});

// Basic CRUD routes using clinic-aware factory
const productRoutes = clinicCrudRoutes('ProductService', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'Product/Service',
  searchFields: ['title', 'description', 'sku'],

  onBeforeCreate: async (data, user, clinicDb) => {
    // Validate SKU uniqueness per clinic
    if (data.sku) {
      const ProductService = await getModel(clinicDb, 'ProductService');
      const existing = await ProductService.findOne({
        where: { sku: data.sku, deletedAt: null }
      });
      if (existing) {
        throw new Error('SKU already exists in this clinic');
      }
    }
    return data;
  }
});

router.use('/', productRoutes);

// TODO: Add custom endpoints
// - GET /:id with categories (many-to-many)
// - POST /:id/duplicate
// - POST /:id/categories (manage many-to-many)
// - Stats endpoint with aggregations
// These require custom clinic-aware transaction handling

module.exports = router;

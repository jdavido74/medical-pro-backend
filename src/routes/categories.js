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
  name: Joi.string().required(),
  description: Joi.string().optional(),
  color: Joi.string().pattern(/^#[0-9A-F]{6}$/i).default('#3B82F6'),
  isActive: Joi.boolean().default(true)
});

const updateSchema = createSchema.optional();

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().optional(),
  isActive: Joi.boolean().optional()
});

// Basic CRUD routes using clinic-aware factory
const categoryRoutes = clinicCrudRoutes('Category', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'Category',
  searchFields: ['name', 'description'],

  onBeforeCreate: async (data, user, clinicDb) => {
    // Validate name uniqueness per clinic
    const Category = await getModel(clinicDb, 'Category');
    const existing = await Category.findOne({
      where: { name: data.name, deletedAt: null }
    });
    if (existing) {
      throw new Error('Category name already exists in this clinic');
    }
    return data;
  }
});

router.use('/', categoryRoutes);

// TODO: Add custom endpoints
// - GET /:id with products count (many-to-many)
// - POST /:id/products (manage many-to-many associations)
// - DELETE /:id with cascade logic
// These require custom clinic-aware transaction handling

module.exports = router;

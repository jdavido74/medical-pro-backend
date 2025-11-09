/**
 * Clients Routes - Clinic Isolated
 * CRUD operations for billing clients with clinic-specific database isolation
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');

const router = express.Router();

const createSchema = Joi.object({
  type: Joi.string().valid('company', 'individual').required(),
  name: Joi.string().min(2).max(255).required(),
  email: Joi.string().email().optional(),
  phone: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).optional(),
  businessNumber: Joi.string().max(20).optional(),
  vatNumber: Joi.string().max(20).optional(),
  address: Joi.object({
    street: Joi.string().max(255).optional(),
    city: Joi.string().max(100).optional(),
    postalCode: Joi.string().max(20).optional(),
    country: Joi.string().max(100).optional(),
    state: Joi.string().max(100).optional(),
    complement: Joi.string().max(255).optional()
  }).optional(),
  billingSettings: Joi.object({
    paymentTerms: Joi.number().integer().min(0).max(365).optional(),
    currency: Joi.string().valid('EUR', 'USD', 'GBP', 'CHF').optional(),
    language: Joi.string().valid('fr', 'en', 'es').optional(),
    sendReminders: Joi.boolean().optional(),
    autoSend: Joi.boolean().optional()
  }).optional(),
  notes: Joi.string().max(1000).optional(),
  isActive: Joi.boolean().default(true)
});

const updateSchema = createSchema.optional();

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(255).optional(),
  type: Joi.string().valid('company', 'individual').optional(),
  isActive: Joi.boolean().default(true)
});

// Basic CRUD routes using clinic-aware factory
const clientRoutes = clinicCrudRoutes('Client', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'Client',
  searchFields: ['name', 'email', 'businessNumber']
});

router.use('/', clientRoutes);

module.exports = router;

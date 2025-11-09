/**
 * Consent Templates Routes - Clinic Isolated
 * CRUD operations for consent templates (clinic-specific database isolation)
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');

const router = express.Router();

const createSchema = Joi.object({
  code: Joi.string().required(),
  title: Joi.string().required(),
  description: Joi.string().optional(),
  terms: Joi.string().required(),
  version: Joi.string().default('1.0'),
  consentType: Joi.string().valid('medical_treatment', 'data_processing', 'photo', 'communication').required(),
  isMandatory: Joi.boolean().optional(),
  autoSend: Joi.boolean().optional(),
  validFrom: Joi.date().iso().required(),
  validUntil: Joi.date().iso().optional()
});

const updateSchema = createSchema.fork(['code', 'title', 'terms', 'validFrom'], (schema) => schema.optional()).min(1);

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  consentType: Joi.string().optional(),
  search: Joi.string().optional()
});

const templateRoutes = clinicCrudRoutes('ConsentTemplate', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'ConsentTemplate',
  searchFields: ['code', 'title']
});

router.use('/', templateRoutes);

module.exports = router;

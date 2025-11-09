/**
 * Practitioners Routes - Clinic Isolated
 * CRUD operations for doctors/practitioners with clinic-specific database isolation
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const schemas = require('../base/validationSchemas');

const router = express.Router();

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(255).optional(),
  isActive: Joi.boolean().optional()
});

const practitionerRoutes = clinicCrudRoutes('Practitioner', {
  createSchema: schemas.createPractitionerSchema,
  updateSchema: schemas.createPractitionerSchema.optional(),
  querySchema,
  displayName: 'Practitioner',
  searchFields: ['firstName', 'lastName', 'licenseNumber']
});

router.use('/', practitionerRoutes);

module.exports = router;

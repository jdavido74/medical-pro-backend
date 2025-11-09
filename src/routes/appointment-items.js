/**
 * Appointment Items Routes - Clinic Isolated
 * CRUD operations for items in appointments (clinic-specific database isolation)
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');

const router = express.Router();

const createSchema = Joi.object({
  appointmentId: Joi.string().uuid().required(),
  productServiceId: Joi.string().uuid().required(),
  quantity: Joi.number().precision(2).positive().required(),
  unitPrice: Joi.number().precision(2).positive().required(),
  notes: Joi.string().max(1000).optional()
});

const updateSchema = createSchema.fork(['appointmentId', 'productServiceId'], (schema) => schema.optional());

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  appointmentId: Joi.string().uuid().optional(),
  status: Joi.string().valid('proposed', 'accepted', 'refused', 'completed').optional()
});

const itemRoutes = clinicCrudRoutes('AppointmentItem', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'AppointmentItem',
  searchFields: []
});

router.use('/', itemRoutes);

module.exports = router;

/**
 * Shared Validation Schemas
 * Common Joi validation schemas used across multiple routes
 *
 * Usage:
 *   const { validateQuery, validateParams, schemas } = require('../utils/validationSchemas');
 *   router.get('/', validateQuery(schemas.pagination), handler);
 *   router.get('/:id', validateParams(schemas.uuidParam), handler);
 */

const Joi = require('joi');

// Common validation schemas
const schemas = {
  // Pagination schema for GET list endpoints
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().allow('').max(255).optional(),
    offset: Joi.number().integer().min(0).optional()
  }).unknown(true), // Allow additional query params

  // UUID parameter validation
  uuidParam: Joi.object({
    id: Joi.string().uuid().required()
  }),

  // Patient ID parameter validation
  patientIdParam: Joi.object({
    patientId: Joi.string().uuid().required()
  }),

  // Provider ID parameter validation
  providerIdParam: Joi.object({
    providerId: Joi.string().uuid().required()
  }),

  // Appointment ID parameter validation
  appointmentIdParam: Joi.object({
    appointmentId: Joi.string().uuid().required()
  }),

  // Medical record ID parameter validation
  medicalRecordIdParam: Joi.object({
    medicalRecordId: Joi.string().uuid().required()
  }),

  // Date range query params
  dateRange: Joi.object({
    date_from: Joi.date().iso().optional(),
    date_to: Joi.date().iso().optional(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional()
  }).unknown(true),

  // Status filter
  statusFilter: Joi.object({
    status: Joi.string().max(50).optional()
  }).unknown(true),

  // Audit log POST schema
  auditLog: Joi.object({
    eventType: Joi.string().required().max(100),
    action: Joi.string().required().max(255),
    resourceType: Joi.string().max(50).optional().allow(null),
    resourceId: Joi.string().uuid().optional().allow(null),
    details: Joi.object().optional()
  }),

  // Audit logs GET query schema
  auditLogsQuery: Joi.object({
    eventType: Joi.string().max(100).optional().allow(null, ''),
    resourceType: Joi.string().max(50).optional().allow(null, ''),
    startDate: Joi.date().iso().optional().allow(null, ''),
    endDate: Joi.date().iso().optional().allow(null, ''),
    limit: Joi.number().integer().min(1).max(10000).default(100),
    offset: Joi.number().integer().min(0).default(0)
  }),

  // Audit export query schema
  auditExportQuery: Joi.object({
    startDate: Joi.date().iso().optional().allow(null, ''),
    endDate: Joi.date().iso().optional().allow(null, '')
  }),

  // Resource ID param for audit
  resourceIdParam: Joi.object({
    resourceId: Joi.string().uuid().required()
  }),

  // Admin users query
  adminUsersQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().allow('').max(255).optional(),
    role: Joi.string().valid('admin', 'user', 'readonly', 'super_admin').optional(),
    companyId: Joi.string().uuid().optional(),
    isActive: Joi.string().valid('true', 'false').optional()
  }),

  // Admin companies query
  adminCompaniesQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().allow('').max(255).optional(),
    country: Joi.string().valid('FR', 'ES').optional()
  }),

  // Admin user update schema
  adminUserUpdate: Joi.object({
    role: Joi.string().valid('admin', 'user', 'readonly').optional(),
    permissions: Joi.object().optional(),
    isActive: Joi.boolean().optional(),
    firstName: Joi.string().max(100).optional(),
    lastName: Joi.string().max(100).optional()
  }).min(1)
};

/**
 * Middleware factory for query validation
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @returns {Function} Express middleware
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: false
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Query validation error',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    // Replace query with validated/coerced values
    req.query = { ...req.query, ...value };
    next();
  };
}

/**
 * Middleware factory for params validation
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @returns {Function} Express middleware
 */
function validateParams(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, { abortEarly: false });

    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Parameter validation error',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    req.params = value;
    next();
  };
}

/**
 * Middleware factory for body validation
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @returns {Function} Express middleware
 */
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });

    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation error',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    req.body = value;
    next();
  };
}

module.exports = {
  schemas,
  validateQuery,
  validateParams,
  validateBody
};

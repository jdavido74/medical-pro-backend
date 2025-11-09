/**
 * Patients Routes - Clinic Isolated
 * CRUD operations for patients with clinic-specific database isolation
 * Each request automatically uses req.clinicDb for data access
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const schemas = require('../base/validationSchemas');
const { Op } = require('sequelize');

const router = express.Router();

// Validation schema for query
const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(255).optional(),
  status: Joi.string().valid('active', 'inactive', 'archived').optional()
});

// Generate clinic-aware CRUD routes
// All queries use req.clinicDb (clinic-specific database)
const patientRoutes = clinicCrudRoutes('Patient', {
  createSchema: schemas.createPatientSchema,
  updateSchema: schemas.updatePatientSchema,
  querySchema,
  displayName: 'Patient',
  searchFields: ['firstName', 'lastName', 'email', 'phone', 'patientNumber'],

  // Business logic hooks
  onBeforeCreate: async (data, user, clinicDb) => {
    // Import Patient model for this clinic
    const { getModel } = require('../base/ModelFactory');
    const Patient = await getModel(clinicDb, 'Patient');

    // Check for duplicates by email + name (clinic-isolated check)
    const existing = await Patient.findOne({
      where: {
        [Op.or]: [
          { email: data.email },
          {
            [Op.and]: [
              { firstName: data.firstName },
              { lastName: data.lastName }
            ]
          }
        ],
        deletedAt: null
      }
    });

    if (existing) {
      throw new Error('Patient with this email or name already exists in this clinic');
    }

    return data;
  },

  onAfterCreate: async (patient, user, clinicDb) => {
    console.log(`✅ Patient created: ${patient.firstName} ${patient.lastName}`, {
      patientId: patient.id,
      clinicId: user.companyId
    });
  }
});

router.use('/', patientRoutes);

module.exports = router;

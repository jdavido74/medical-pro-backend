/**
 * Prescriptions Routes - Ordonnances médicales
 * CRUD operations for medical prescriptions with clinic-specific database isolation
 *
 * Compliance: RGPD, Secret Médical (Art. L1110-4 CSP)
 * - Full audit trail for all access
 * - Permission-based access control
 * - Print tracking and traceability
 */

const express = require('express');
const Joi = require('joi');
const { Op } = require('sequelize');
const { getModel } = require('../base/ModelFactory');
const { PERMISSIONS, getPermissionsForRole } = require('../utils/permissionConstants');
const { validateParams, validateQuery, schemas } = require('../utils/validationSchemas');
const { getPermissionsFromClinicRoles } = require('../middleware/permissions');

const router = express.Router();

// Validation schemas
const createPrescriptionSchema = Joi.object({
  patient_id: Joi.string().uuid().required(),
  provider_id: Joi.string().uuid().allow(null).optional(),
  medical_record_id: Joi.string().uuid().allow(null).optional(),
  facility_id: Joi.string().uuid().allow(null).optional(),
  medications: Joi.array().items(Joi.object({
    medication: Joi.string().required(),
    dosage: Joi.string().allow('').required(),
    frequency: Joi.string().allow('').required(),
    route: Joi.string().valid('oral', 'iv', 'im', 'topical', 'inhaled', 'sublingual', 'rectal').default('oral'),
    duration: Joi.string().allow('').optional(),
    quantity: Joi.string().allow('').optional(),
    instructions: Joi.string().allow('').optional()
  })).required(),
  instructions: Joi.string().allow('', null).optional(),
  additional_notes: Joi.string().allow('', null).optional(),
  prescribed_date: Joi.date().allow(null).optional(),
  valid_until: Joi.date().allow(null).optional(),
  renewable: Joi.boolean().default(false),
  renewals_remaining: Joi.number().integer().min(0).default(0),
  patient_snapshot: Joi.object().optional(),
  provider_snapshot: Joi.object().optional(),
  vital_signs: Joi.object().optional(),
  diagnosis: Joi.object().optional()
});

const updatePrescriptionSchema = Joi.object({
  medications: Joi.array().items(Joi.object({
    medication: Joi.string().required(),
    dosage: Joi.string().required(),
    frequency: Joi.string().required(),
    route: Joi.string().valid('oral', 'iv', 'im', 'topical', 'inhaled', 'sublingual', 'rectal').default('oral'),
    duration: Joi.string().optional(),
    quantity: Joi.string().optional(),
    instructions: Joi.string().optional()
  })).optional(),
  instructions: Joi.string().allow('').optional(),
  additional_notes: Joi.string().allow('').optional(),
  valid_until: Joi.date().optional(),
  renewable: Joi.boolean().optional(),
  renewals_remaining: Joi.number().integer().min(0).optional(),
  vital_signs: Joi.object().optional(),
  diagnosis: Joi.object().optional()
});

/**
 * Check if user has permission
 * Now uses clinic_roles table as source of truth
 */
async function hasPermission(req, permission) {
  const user = req.user;
  if (!user) return false;
  if (user.role === 'super_admin') return true;

  // Get permissions from clinic_roles (source of truth)
  const rolePermissions = await getPermissionsFromClinicRoles(user.companyId, user.role);
  return rolePermissions.includes(permission);
}

/**
 * Log access to prescription (RGPD compliance)
 */
async function logPrescriptionAccess(prescription, action, user, req, details = {}) {
  try {
    const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    await prescription.logAccess(action, user?.userId || user?.id || 'unknown', clientIP, details);
  } catch (error) {
    console.error('[Prescriptions] Error logging access:', error.message);
  }
}

/**
 * GET /
 * Retrieve all prescriptions with pagination and filters
 */
router.get('/', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé aux ordonnances' }
      });
    }

    const { page = 1, limit = 20, patient_id, status, date_from, date_to } = req.query;

    const Prescription = await getModel(req.clinicDb, 'Prescription');

    const where = {};
    if (patient_id) where.patient_id = patient_id;
    if (status) where.status = status;
    if (date_from || date_to) {
      where.prescribed_date = {};
      if (date_from) where.prescribed_date[Op.gte] = new Date(date_from);
      if (date_to) where.prescribed_date[Op.lte] = new Date(date_to);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { count, rows } = await Prescription.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset,
      order: [['prescribed_date', 'DESC'], ['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[Prescriptions] GET / error:', error);
    next(error);
  }
});

/**
 * GET /patient/:patientId
 * Get all prescriptions for a patient
 */
router.get('/patient/:patientId', validateParams(schemas.patientIdParam), async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const { patientId } = req.params;
    const Prescription = await getModel(req.clinicDb, 'Prescription');

    const prescriptions = await Prescription.getByPatient(patientId);

    res.json({
      success: true,
      data: prescriptions
    });
  } catch (error) {
    console.error('[Prescriptions] GET /patient/:patientId error:', error);
    next(error);
  }
});

/**
 * GET /medical-record/:medicalRecordId
 * Get prescriptions for a specific medical record
 */
router.get('/medical-record/:medicalRecordId', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const { medicalRecordId } = req.params;
    const Prescription = await getModel(req.clinicDb, 'Prescription');

    const prescriptions = await Prescription.getByMedicalRecord(medicalRecordId);

    res.json({
      success: true,
      data: prescriptions
    });
  } catch (error) {
    console.error('[Prescriptions] GET /medical-record/:medicalRecordId error:', error);
    next(error);
  }
});

/**
 * GET /:id
 * Get a single prescription by ID
 */
router.get('/:id', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const Prescription = await getModel(req.clinicDb, 'Prescription');
    const prescription = await Prescription.findByPk(req.params.id);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        error: { message: 'Ordonnance non trouvée' }
      });
    }

    // Log access
    await logPrescriptionAccess(prescription, 'view', req.user, req);

    res.json({
      success: true,
      data: prescription
    });
  } catch (error) {
    console.error('[Prescriptions] GET /:id error:', error);
    next(error);
  }
});

/**
 * POST /
 * Create a new prescription
 */
router.post('/', async (req, res, next) => {
  try {
    const canCreate = await hasPermission(req, PERMISSIONS.MEDICAL_NOTES_CREATE) ||
                      await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_EDIT);

    if (!canCreate) {
      return res.status(403).json({
        success: false,
        error: { message: 'Vous n\'avez pas la permission de créer des ordonnances' }
      });
    }

    // Validate
    const { error, value: data } = createPrescriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Données invalides', details: error.details.map(d => d.message).join(', ') }
      });
    }

    const Prescription = await getModel(req.clinicDb, 'Prescription');

    // Auto-fill facility_id if not provided
    if (!data.facility_id) {
      try {
        const [facilities] = await req.clinicDb.query(
          `SELECT id FROM medical_facilities WHERE is_active = true LIMIT 1`
        );
        if (facilities && facilities.length > 0) {
          data.facility_id = facilities[0].id;
        }
      } catch (err) {
        console.error('[Prescriptions] Error getting facility:', err.message);
      }
    }

    // Set provider if not specified
    if (!data.provider_id && req.user?.userId) {
      data.provider_id = req.user.userId;
    }

    // Generate prescription number
    data.prescription_number = await Prescription.generatePrescriptionNumber();

    // Set default prescribed date
    if (!data.prescribed_date) {
      data.prescribed_date = new Date();
    }

    // Initial access log
    const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    data.access_log = [{
      action: 'create',
      userId: req.user?.userId || 'unknown',
      timestamp: new Date().toISOString(),
      ipAddress: clientIP
    }];

    // Create prescription
    const prescription = await Prescription.create(data);

    console.log(`[Prescriptions] ✅ Created prescription ${prescription.prescription_number} for patient ${data.patient_id}`);

    res.status(201).json({
      success: true,
      data: prescription,
      message: 'Ordonnance créée avec succès'
    });
  } catch (error) {
    console.error('[Prescriptions] POST / error:', error);
    next(error);
  }
});

/**
 * PUT /:id
 * Update a prescription (only if draft)
 */
router.put('/:id', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_EDIT)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const Prescription = await getModel(req.clinicDb, 'Prescription');
    const prescription = await Prescription.findByPk(req.params.id);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        error: { message: 'Ordonnance non trouvée' }
      });
    }

    if (!prescription.canBeModified()) {
      return res.status(403).json({
        success: false,
        error: { message: 'Cette ordonnance est finalisée et ne peut plus être modifiée' }
      });
    }

    // Validate
    const { error, value: data } = updatePrescriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Données invalides', details: error.details.map(d => d.message).join(', ') }
      });
    }

    await prescription.update(data);
    await logPrescriptionAccess(prescription, 'update', req.user, req, { fields: Object.keys(data) });

    res.json({
      success: true,
      data: prescription,
      message: 'Ordonnance mise à jour'
    });
  } catch (error) {
    console.error('[Prescriptions] PUT /:id error:', error);
    next(error);
  }
});

/**
 * POST /:id/finalize
 * Finalize a prescription (locks it for editing)
 */
router.post('/:id/finalize', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_EDIT)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const Prescription = await getModel(req.clinicDb, 'Prescription');
    const prescription = await Prescription.findByPk(req.params.id);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        error: { message: 'Ordonnance non trouvée' }
      });
    }

    await prescription.finalize(req.user?.userId);
    await logPrescriptionAccess(prescription, 'finalize', req.user, req);

    res.json({
      success: true,
      data: prescription,
      message: 'Ordonnance finalisée'
    });
  } catch (error) {
    console.error('[Prescriptions] POST /:id/finalize error:', error);
    next(error);
  }
});

/**
 * POST /:id/print
 * Mark prescription as printed (increments print count)
 */
router.post('/:id/print', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const Prescription = await getModel(req.clinicDb, 'Prescription');
    const prescription = await Prescription.findByPk(req.params.id);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        error: { message: 'Ordonnance non trouvée' }
      });
    }

    await prescription.markPrinted();
    await logPrescriptionAccess(prescription, 'print', req.user, req, { printCount: prescription.print_count });

    res.json({
      success: true,
      data: prescription,
      message: `Ordonnance imprimée (${prescription.print_count}x)`
    });
  } catch (error) {
    console.error('[Prescriptions] POST /:id/print error:', error);
    next(error);
  }
});

/**
 * DELETE /:id
 * Cancel a prescription (soft delete via status change)
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_DELETE)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const Prescription = await getModel(req.clinicDb, 'Prescription');
    const prescription = await Prescription.findByPk(req.params.id);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        error: { message: 'Ordonnance non trouvée' }
      });
    }

    // Cancel instead of delete for traceability
    await prescription.update({ status: 'cancelled' });
    await logPrescriptionAccess(prescription, 'cancel', req.user, req);

    res.json({
      success: true,
      message: 'Ordonnance annulée'
    });
  } catch (error) {
    console.error('[Prescriptions] DELETE /:id error:', error);
    next(error);
  }
});

module.exports = router;

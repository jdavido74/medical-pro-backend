/**
 * Medical Records Routes - Clinic Isolated
 * CRUD operations for medical records with clinic-specific database isolation
 *
 * Compliance: RGPD, Secret Médical (Art. L1110-4 CSP)
 * - Full audit trail for all access
 * - Permission-based access control
 * - Medical data protected by healthcare professional permissions
 */

const express = require('express');
const Joi = require('joi');
const { Op } = require('sequelize');
const { getModel } = require('../base/ModelFactory');
const schemas = require('../base/validationSchemas');
const { PERMISSIONS, getPermissionsForRole } = require('../utils/permissionConstants');
const { getPermissionsFromClinicRoles } = require('../middleware/permissions');

const router = express.Router();

/**
 * Sync treatments back to appointment_items
 * Compares current treatments with original_treatments snapshot to update statuses
 */
async function syncTreatmentsToAppointment(clinicDb, appointmentId, treatments, originalTreatments) {
  if (!appointmentId || !originalTreatments || !Array.isArray(treatments)) return;

  try {
    const AppointmentItem = await getModel(clinicDb, 'AppointmentItem');

    // Build a map of current treatments by appointment_item_id
    const currentByItemId = {};
    for (const t of treatments) {
      if (t.appointment_item_id) {
        currentByItemId[t.appointment_item_id] = t;
      }
    }

    // Check each original treatment
    for (const orig of originalTreatments) {
      if (!orig.appointment_item_id) continue;

      const current = currentByItemId[orig.appointment_item_id];

      if (!current) {
        // Treatment was removed → mark as refused
        await AppointmentItem.update(
          { status: 'refused' },
          { where: { id: orig.appointment_item_id } }
        );
      } else if (current.medication !== orig.medication) {
        // Medication was changed → mark as completed (modified)
        await AppointmentItem.update(
          { status: 'completed' },
          { where: { id: orig.appointment_item_id } }
        );
      } else {
        // Unchanged → mark as accepted
        await AppointmentItem.update(
          { status: 'accepted' },
          { where: { id: orig.appointment_item_id } }
        );
      }
    }

    console.log(`[MedicalRecords] ✅ Synced treatments to appointment ${appointmentId}`);
  } catch (error) {
    console.error('[MedicalRecords] Error syncing treatments to appointment:', error.message);
  }
}

/**
 * Helper: Get healthcare_provider.id from central user id
 */
async function getProviderIdFromUser(clinicDb, centralUserId) {
  const HealthcareProvider = await getModel(clinicDb, 'HealthcareProvider');
  const provider = await HealthcareProvider.findOne({
    where: { central_user_id: centralUserId },
    attributes: ['id']
  });
  return provider?.id || null;
}

// Validation schema for query parameters
const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(255).allow('').optional(),
  patient_id: Joi.string().uuid().optional(),
  provider_id: Joi.string().uuid().optional(),
  record_type: Joi.string().valid('consultation', 'examination', 'treatment', 'follow_up', 'emergency', 'prescription', 'lab_result', 'imaging', 'note').optional(),
  date_from: Joi.date().iso().optional(),
  date_to: Joi.date().iso().optional(),
  archived: Joi.boolean().optional()
});

/**
 * Check if user has permission to access medical records
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
 * Log access to medical record (RGPD compliance)
 */
async function logRecordAccess(record, action, user, req, details = {}) {
  try {
    const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    await record.logAccess(action, user?.userId || user?.id || 'unknown', clientIP, details);
  } catch (error) {
    console.error('[MedicalRecords] Error logging access:', error.message);
  }
}

/**
 * GET /appointment/:appointmentId/treatments
 * Load treatments from an appointment for pre-filling a medical record
 * Requires: medical_records.view permission
 */
router.get('/appointment/:appointmentId/treatments', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const { appointmentId } = req.params;

    // Load the appointment with its main service
    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const AppointmentItem = await getModel(req.clinicDb, 'AppointmentItem');

    const appointment = await Appointment.findByPk(appointmentId, {
      include: [
        { model: ProductService, as: 'service', attributes: ['id', 'name', 'type'] }
      ]
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: { message: 'Rendez-vous non trouvé' }
      });
    }

    const treatments = [];

    // Add main service as a treatment
    if (appointment.service) {
      treatments.push({
        medication: appointment.service.name,
        catalog_item_id: appointment.service.id,
        catalog_item_type: appointment.service.type || 'service',
        origin: 'appointment',
        appointment_item_id: null,
        status: 'active'
      });
    }

    // Load appointment items with their product/service info
    const items = await AppointmentItem.findAll({
      where: { appointment_id: appointmentId },
      include: [
        { model: ProductService, as: 'productService', attributes: ['id', 'name', 'type'] }
      ]
    });

    for (const item of items) {
      treatments.push({
        medication: item.productService?.name || 'Unknown',
        catalog_item_id: item.product_service_id,
        catalog_item_type: item.productService?.type || 'service',
        origin: 'appointment',
        appointment_item_id: item.id,
        status: item.status === 'proposed' ? 'active' : item.status
      });
    }

    res.json({
      success: true,
      data: treatments
    });
  } catch (error) {
    console.error('[MedicalRecords] GET /appointment/:appointmentId/treatments error:', error);
    next(error);
  }
});

/**
 * POST /vitals
 * Find-or-create a medical record for today and save vital signs
 * - No existing record today → create new with appointment treatments
 * - Same appointment_id → append to additional_readings
 * - Different appointment_id → return 409 for user decision
 * - use_existing_record_id → append to that record
 * - force_create → create new record regardless
 * Requires: medical_notes.create or medical_records.edit permission
 */
const vitalsSchema = Joi.object({
  patient_id: Joi.string().uuid().required(),
  appointment_id: Joi.string().uuid().required(),
  vital_signs: Joi.object().required(),
  use_existing_record_id: Joi.string().uuid().optional(),
  force_create: Joi.boolean().optional()
});

router.post('/vitals', async (req, res, next) => {
  try {
    const canCreate = await hasPermission(req, PERMISSIONS.MEDICAL_NOTES_CREATE) ||
                      await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_EDIT);
    if (!canCreate) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const { error, value: data } = vitalsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Données invalides', details: error.details.map(d => d.message).join(', ') }
      });
    }

    const { patient_id, appointment_id, vital_signs, use_existing_record_id, force_create } = data;
    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');

    // --- Helper: load treatments from appointment ---
    async function getAppointmentTreatments(apptId) {
      const Appointment = await getModel(req.clinicDb, 'Appointment');
      const ProductService = await getModel(req.clinicDb, 'ProductService');
      const AppointmentItem = await getModel(req.clinicDb, 'AppointmentItem');

      const appointment = await Appointment.findByPk(apptId, {
        include: [{ model: ProductService, as: 'service', attributes: ['id', 'name', 'type'] }]
      });
      if (!appointment) return [];

      const treatments = [];
      if (appointment.service) {
        treatments.push({
          medication: appointment.service.name,
          catalog_item_id: appointment.service.id,
          catalog_item_type: appointment.service.type || 'service',
          origin: 'appointment',
          appointment_item_id: null,
          status: 'active'
        });
      }

      const items = await AppointmentItem.findAll({
        where: { appointment_id: apptId },
        include: [{ model: ProductService, as: 'productService', attributes: ['id', 'name', 'type'] }]
      });
      for (const item of items) {
        treatments.push({
          medication: item.productService?.name || 'Unknown',
          catalog_item_id: item.product_service_id,
          catalog_item_type: item.productService?.type || 'service',
          origin: 'appointment',
          appointment_item_id: item.id,
          status: item.status === 'proposed' ? 'active' : item.status
        });
      }
      return treatments;
    }

    // --- Helper: build a reading object ---
    function buildReading(vs) {
      return {
        timestamp: new Date().toISOString(),
        appointment_id,
        ...vs
      };
    }

    // --- Helper: create a new record with vitals + treatments ---
    async function createNewRecord() {
      const treatments = await getAppointmentTreatments(appointment_id);

      // Auto-fill facility_id
      let facility_id = null;
      try {
        const [facilities] = await req.clinicDb.query(
          `SELECT id FROM medical_facilities WHERE is_active = true LIMIT 1`
        );
        facility_id = facilities?.[0]?.id || req.user.companyId || null;
      } catch (err) {
        facility_id = req.user.companyId || null;
      }

      // Get provider
      const providerId = await getProviderIdFromUser(req.clinicDb, req.user?.id);

      const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      const recordData = {
        patient_id,
        appointment_id,
        facility_id,
        provider_id: providerId,
        created_by: providerId || req.user?.id,
        record_type: 'consultation',
        vital_signs,
        treatments: treatments.length > 0 ? treatments : undefined,
        original_treatments: treatments.length > 0 ? treatments : undefined,
        access_log: [{
          action: 'create',
          userId: req.user?.id || 'unknown',
          timestamp: new Date().toISOString(),
          ipAddress: clientIP
        }]
      };

      const record = await MedicalRecord.create(recordData);
      console.log(`[MedicalRecords] ✅ POST /vitals — Created record ${record.id} for patient ${patient_id}`);
      return record;
    }

    // --- Helper: append vitals to existing record ---
    async function appendToRecord(record) {
      const currentVS = record.vital_signs || {};
      const readings = currentVS.additional_readings || [];
      readings.push(buildReading(vital_signs));

      const updatedVS = { ...currentVS, additional_readings: readings };
      await record.update({ vital_signs: updatedVS });
      await logRecordAccess(record, 'update', req.user, req, { fields: ['vital_signs'] });

      console.log(`[MedicalRecords] ✅ POST /vitals — Appended reading to record ${record.id} (${readings.length} readings total)`);
      return record;
    }

    // --- Option A: force_create ---
    if (force_create) {
      const record = await createNewRecord();
      return res.status(201).json({ success: true, action: 'created', data: record });
    }

    // --- Option B: use_existing_record_id ---
    if (use_existing_record_id) {
      const existingRecord = await MedicalRecord.findByPk(use_existing_record_id);
      if (!existingRecord || existingRecord.archived || existingRecord.is_locked) {
        return res.status(404).json({
          success: false,
          error: { message: 'Dossier existant non trouvé ou verrouillé' }
        });
      }
      const record = await appendToRecord(existingRecord);
      return res.json({ success: true, action: 'appended', data: record });
    }

    // --- Find existing record(s) for this patient today ---
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfNextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const existingRecords = await MedicalRecord.findAll({
      where: {
        patient_id,
        archived: false,
        is_locked: false,
        consultation_date: {
          [Op.gte]: startOfDay,
          [Op.lt]: startOfNextDay
        }
      },
      order: [['consultation_date', 'DESC']]
    });

    // --- Case 1: No existing record → create ---
    if (existingRecords.length === 0) {
      const record = await createNewRecord();
      return res.status(201).json({ success: true, action: 'created', data: record });
    }

    // --- Case 2: Record exists with same appointment_id → append ---
    const sameApptRecord = existingRecords.find(r => r.appointment_id === appointment_id);
    if (sameApptRecord) {
      const record = await appendToRecord(sameApptRecord);
      return res.json({ success: true, action: 'appended', data: record });
    }

    // --- Case 3: Record exists but different appointment → 409 conflict ---
    const conflictRecord = existingRecords[0];
    return res.status(409).json({
      success: false,
      action: 'conflict',
      existingRecord: {
        id: conflictRecord.id,
        appointment_id: conflictRecord.appointment_id,
        consultation_date: conflictRecord.consultation_date,
        record_type: conflictRecord.record_type,
        vital_signs: conflictRecord.vital_signs
      }
    });
  } catch (error) {
    console.error('[MedicalRecords] POST /vitals error:', error);
    next(error);
  }
});

/**
 * GET /
 * Retrieve all medical records with pagination and filters
 * Requires: medical_records.view permission
 */
router.get('/', async (req, res, next) => {
  try {
    // Check permission
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Accès refusé',
          details: 'Vous n\'avez pas la permission de consulter les dossiers médicaux'
        }
      });
    }

    // Validate query params
    const { error, value: params } = querySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Paramètres invalides',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    const { page, limit, search, patient_id, provider_id, record_type, date_from, date_to, archived } = params;

    // Get model
    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');

    // Build where clause
    const where = {};

    // Filter archived (default: show only non-archived)
    where.archived = archived === true;

    // Filter by patient
    if (patient_id) {
      where.patient_id = patient_id;
    }

    // Filter by provider
    if (provider_id) {
      where.provider_id = provider_id;
    }

    // Filter by record type
    if (record_type) {
      where.record_type = record_type;
    }

    // Filter by date range
    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at[Op.gte] = new Date(date_from);
      if (date_to) where.created_at[Op.lte] = new Date(date_to);
    }

    // Search in chief_complaint, notes
    if (search) {
      where[Op.or] = [
        { chief_complaint: { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Execute query with pagination
    const offset = (page - 1) * limit;
    const { count, rows } = await MedicalRecord.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
        hasNextPage: page < Math.ceil(count / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('[MedicalRecords] GET / error:', error);
    next(error);
  }
});

/**
 * GET /patient/:patientId
 * Get all medical records for a specific patient
 * Requires: medical_records.view permission
 */
router.get('/patient/:patientId', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Accès refusé',
          details: 'Vous n\'avez pas la permission de consulter les dossiers médicaux'
        }
      });
    }

    const { patientId } = req.params;
    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');

    const history = await MedicalRecord.getPatientHistory(patientId);

    res.json({
      success: true,
      data: history.records,
      statistics: history.statistics,
      activeTreatments: history.activeTreatments,
      allergies: history.allergies,
      byType: history.byType
    });
  } catch (error) {
    console.error('[MedicalRecords] GET /patient/:patientId error:', error);
    next(error);
  }
});

/**
 * GET /statistics
 * Get medical records statistics
 * Requires: medical_records.view permission
 */
router.get('/statistics', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');

    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisYear = new Date(now.getFullYear(), 0, 1);

    // Total records
    const total = await MedicalRecord.count({ where: { archived: false } });
    const thisMonthCount = await MedicalRecord.count({
      where: {
        archived: false,
        created_at: { [Op.gte]: thisMonth }
      }
    });
    const thisYearCount = await MedicalRecord.count({
      where: {
        archived: false,
        created_at: { [Op.gte]: thisYear }
      }
    });

    // By type
    const byType = {};
    const types = ['consultation', 'examination', 'treatment', 'follow_up', 'emergency', 'prescription', 'lab_result', 'imaging', 'note'];
    for (const type of types) {
      byType[type] = await MedicalRecord.count({
        where: { archived: false, record_type: type }
      });
    }

    res.json({
      success: true,
      data: {
        total,
        thisMonth: thisMonthCount,
        thisYear: thisYearCount,
        byType
      }
    });
  } catch (error) {
    console.error('[MedicalRecords] GET /statistics error:', error);
    next(error);
  }
});

/**
 * GET /:id
 * Retrieve a single medical record by ID
 * Requires: medical_records.view permission
 */
router.get('/:id', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_VIEW)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Accès refusé',
          details: 'Vous n\'avez pas la permission de consulter les dossiers médicaux'
        }
      });
    }

    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');
    const record = await MedicalRecord.findByPk(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Dossier médical non trouvé',
          details: 'Aucun dossier médical avec cet identifiant'
        }
      });
    }

    // Log access (RGPD compliance)
    await logRecordAccess(record, 'view', req.user, req);

    res.json({
      success: true,
      data: record
    });
  } catch (error) {
    console.error('[MedicalRecords] GET /:id error:', error);
    next(error);
  }
});

/**
 * POST /
 * Create a new medical record
 * Requires: medical_records.view + medical_notes.create or medical_records.edit permission
 */
router.post('/', async (req, res, next) => {
  try {
    const canCreate = await hasPermission(req, PERMISSIONS.MEDICAL_NOTES_CREATE) ||
                      await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_EDIT);

    if (!canCreate) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Accès refusé',
          details: 'Vous n\'avez pas la permission de créer des dossiers médicaux'
        }
      });
    }

    // Validate request body
    const { error, value: data } = schemas.createMedicalRecordSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Données invalides',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');

    // Auto-fill facility_id if not provided
    if (!data.facility_id) {
      try {
        const [facilities] = await req.clinicDb.query(
          `SELECT id FROM medical_facilities WHERE is_active = true LIMIT 1`
        );
        if (facilities && facilities.length > 0) {
          data.facility_id = facilities[0].id;
        } else if (req.user.companyId) {
          data.facility_id = req.user.companyId;
        }
      } catch (err) {
        if (req.user.companyId) {
          data.facility_id = req.user.companyId;
        }
      }
    }

    // Set provider if not specified - use healthcare_provider.id, not central user id
    if (!data.provider_id && req.user?.id) {
      const providerId = await getProviderIdFromUser(req.clinicDb, req.user.id);
      if (providerId) {
        data.provider_id = providerId;
      }
    }

    // Set created_by - also use provider_id for consistency
    if (!data.created_by && req.user?.id) {
      const providerId = await getProviderIdFromUser(req.clinicDb, req.user.id);
      data.created_by = providerId || req.user.id;
    }

    // Check medication interactions
    if (data.treatments && data.treatments.length > 0) {
      data.medication_warnings = MedicalRecord.checkMedicationInteractions(data.treatments);
    }

    // Initial access log
    const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    data.access_log = [{
      action: 'create',
      userId: req.user?.id || 'unknown',
      timestamp: new Date().toISOString(),
      ipAddress: clientIP
    }];

    // Create record
    const record = await MedicalRecord.create(data);

    // Sync treatments back to appointment if linked
    if (data.appointment_id && data.original_treatments) {
      await syncTreatmentsToAppointment(req.clinicDb, data.appointment_id, data.treatments, data.original_treatments);
    }

    console.log(`[MedicalRecords] ✅ Created record ${record.id} for patient ${data.patient_id}`);

    res.status(201).json({
      success: true,
      data: record,
      message: 'Dossier médical créé avec succès'
    });
  } catch (error) {
    console.error('[MedicalRecords] POST / error:', error);
    next(error);
  }
});

/**
 * PUT /:id
 * Update a medical record
 * Requires: medical_records.edit permission
 */
router.put('/:id', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_EDIT)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Accès refusé',
          details: 'Vous n\'avez pas la permission de modifier les dossiers médicaux'
        }
      });
    }

    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');
    const record = await MedicalRecord.findByPk(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Dossier médical non trouvé'
        }
      });
    }

    // Check if record can be modified
    if (!record.canBeModified()) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Modification impossible',
          details: 'Ce dossier est verrouillé ou archivé'
        }
      });
    }

    // Validate request body
    const { error, value: data } = schemas.updateMedicalRecordSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Données invalides',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    // Check medication interactions if treatments updated
    if (data.treatments) {
      data.medication_warnings = MedicalRecord.checkMedicationInteractions(data.treatments);
    }

    // Update record
    await record.update(data);

    // Sync treatments back to appointment if linked
    const appointmentId = data.appointment_id || record.appointment_id;
    const originalTreatments = data.original_treatments || record.original_treatments;
    if (appointmentId && originalTreatments) {
      await syncTreatmentsToAppointment(req.clinicDb, appointmentId, data.treatments || record.treatments, originalTreatments);
    }

    // Log access
    await logRecordAccess(record, 'update', req.user, req, { fields: Object.keys(data) });

    console.log(`[MedicalRecords] ✅ Updated record ${record.id}`);

    res.json({
      success: true,
      data: record,
      message: 'Dossier médical mis à jour'
    });
  } catch (error) {
    console.error('[MedicalRecords] PUT /:id error:', error);
    next(error);
  }
});

/**
 * POST /:id/sign
 * Sign and lock a medical record
 * Requires: medical_records.edit permission
 */
router.post('/:id/sign', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_EDIT)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');
    const record = await MedicalRecord.findByPk(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: { message: 'Dossier médical non trouvé' }
      });
    }

    if (record.is_signed) {
      return res.status(400).json({
        success: false,
        error: { message: 'Ce dossier est déjà signé' }
      });
    }

    // Get healthcare_provider.id instead of central user id
    const providerId = await getProviderIdFromUser(req.clinicDb, req.user?.id);

    await record.sign(providerId);
    await logRecordAccess(record, 'sign', req.user, req);

    res.json({
      success: true,
      data: record,
      message: 'Dossier signé et verrouillé'
    });
  } catch (error) {
    console.error('[MedicalRecords] POST /:id/sign error:', error);
    next(error);
  }
});

/**
 * DELETE /:id
 * Archive a medical record (soft delete)
 * Requires: medical_records.delete permission
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_DELETE)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Accès refusé',
          details: 'Vous n\'avez pas la permission de supprimer les dossiers médicaux'
        }
      });
    }

    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');
    const record = await MedicalRecord.findByPk(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: { message: 'Dossier médical non trouvé' }
      });
    }

    // Archive (soft delete) - use healthcare_provider.id
    const providerId = await getProviderIdFromUser(req.clinicDb, req.user?.id);
    await record.archive(providerId);
    await logRecordAccess(record, 'archive', req.user, req);

    console.log(`[MedicalRecords] 🗑️ Archived record ${record.id}`);

    res.json({
      success: true,
      message: 'Dossier médical archivé'
    });
  } catch (error) {
    console.error('[MedicalRecords] DELETE /:id error:', error);
    next(error);
  }
});

/**
 * POST /:id/restore
 * Restore an archived medical record
 * Requires: medical_records.delete permission
 */
router.post('/:id/restore', async (req, res, next) => {
  try {
    if (!await hasPermission(req, PERMISSIONS.MEDICAL_RECORDS_DELETE)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Accès refusé' }
      });
    }

    const MedicalRecord = await getModel(req.clinicDb, 'MedicalRecord');
    const record = await MedicalRecord.findByPk(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: { message: 'Dossier médical non trouvé' }
      });
    }

    await record.unarchive();
    await logRecordAccess(record, 'restore', req.user, req);

    res.json({
      success: true,
      data: record,
      message: 'Dossier médical restauré'
    });
  } catch (error) {
    console.error('[MedicalRecords] POST /:id/restore error:', error);
    next(error);
  }
});

module.exports = router;

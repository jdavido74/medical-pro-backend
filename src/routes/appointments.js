/**
 * Appointments Routes - Clinic Isolated
 * CRUD operations for appointments with clinic-specific database isolation
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const { getModel } = require('../base/ModelFactory');
const schemas = require('../base/validationSchemas');
const { logger } = require('../utils/logger');
const { Op } = require('sequelize');
const { PERMISSIONS } = require('../utils/permissionConstants');

const router = express.Router();

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(1000).default(20),
  search: Joi.string().max(255).allow('').optional(),
  status: Joi.string().valid('scheduled', 'confirmed', 'cancelled', 'completed', 'no-show').optional(),
  patientId: Joi.string().uuid().optional(),
  practitionerId: Joi.string().uuid().optional()
});

const appointmentRoutes = clinicCrudRoutes('Appointment', {
  createSchema: schemas.createAppointmentSchema,
  updateSchema: schemas.createAppointmentSchema.optional(),
  querySchema,
  displayName: 'Appointment',
  searchFields: ['reason'],
  // Sort by appointment_date DESC to show recent AND past appointments
  defaultOrder: [['appointment_date', 'DESC'], ['start_time', 'DESC']],

  // Permission configuration - uses clinic_roles as source of truth
  permissions: {
    view: PERMISSIONS.APPOINTMENTS_VIEW,
    create: PERMISSIONS.APPOINTMENTS_CREATE,
    update: PERMISSIONS.APPOINTMENTS_EDIT,
    delete: PERMISSIONS.APPOINTMENTS_DELETE
  },

  // Include patient data in appointment responses
  includeRelations: async (clinicDb) => {
    // Load both models to ensure associations are setup
    const Appointment = await getModel(clinicDb, 'Appointment');
    const Patient = await getModel(clinicDb, 'Patient');

    // Ensure association is established (in case of race condition)
    if (!Appointment.associations?.patient) {
      Appointment.belongsTo(Patient, {
        foreignKey: 'patient_id',
        as: 'patient'
      });
    }

    return [
      {
        model: Patient,
        as: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'patient_number']
      }
    ];
  },

  onBeforeCreate: async (data, user, clinicDb) => {
    // Set default facility_id if not provided - fetch from database using raw SQL
    if (!data.facility_id) {
      try {
        const [facilities] = await clinicDb.query(
          'SELECT id FROM medical_facilities LIMIT 1'
        );
        if (facilities && facilities.length > 0) {
          data.facility_id = facilities[0].id;
        } else {
          throw new Error('No medical facility found for this clinic');
        }
      } catch (err) {
        logger.error('Could not fetch default facility_id', { error: err.message });
        throw new Error('Unable to determine facility for appointment');
      }
    }

    // Ensure we use provider_id (NOT practitioner_id!)
    if (data.practitioner_id && !data.provider_id) {
      data.provider_id = data.practitioner_id;
      delete data.practitioner_id;
    }

    // If no title provided, use patient's name as default
    if (!data.title && data.patient_id) {
      try {
        const Patient = await getModel(clinicDb, 'Patient');
        const patient = await Patient.findByPk(data.patient_id, {
          attributes: ['first_name', 'last_name']
        });
        if (patient) {
          data.title = `${patient.first_name} ${patient.last_name}`;
        }
      } catch (err) {
        logger.warn('Could not fetch patient name for appointment title', { error: err.message });
      }
    }

    // Check for time conflicts (clinic-isolated)
    const Appointment = await getModel(clinicDb, 'Appointment');

    // Note: Database uses snake_case field names
    const conflict = await Appointment.findOne({
      where: {
        provider_id: data.provider_id,
        appointment_date: data.appointment_date,
        status: { [Op.ne]: 'cancelled' },
        [Op.or]: [
          // New appointment starts during existing appointment
          {
            start_time: { [Op.lte]: data.start_time },
            end_time: { [Op.gt]: data.start_time }
          },
          // New appointment ends during existing appointment
          {
            start_time: { [Op.lt]: data.end_time },
            end_time: { [Op.gte]: data.end_time }
          },
          // New appointment completely contains existing appointment
          {
            start_time: { [Op.gte]: data.start_time },
            end_time: { [Op.lte]: data.end_time }
          }
        ]
      }
    });

    if (conflict) {
      throw new Error(`Time slot ${data.start_time}-${data.end_time} conflicts with another appointment`);
    }

    return data;
  },

  onAfterCreate: async (appointment, user, clinicDb) => {
    logger.info(`Appointment created`, {
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      providerId: appointment.providerId,
      startTime: appointment.startTime
    });
  }
});

router.use('/', appointmentRoutes);

// Add items to appointment (clinic-isolated)
router.post('/:appointmentId/items', async (req, res, next) => {
  try {
    const { appointmentId } = req.params;
    const itemsData = Array.isArray(req.body) ? req.body : [req.body];

    // Get models for this clinic
    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const AppointmentItem = await getModel(req.clinicDb, 'AppointmentItem');

    // Validate appointment exists in this clinic
    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, error: { message: 'Appointment not found' } });
    }

    // Create items
    const createdItems = await Promise.all(
      itemsData.map(item =>
        AppointmentItem.create({
          appointmentId: appointmentId,
          productServiceId: item.productServiceId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          notes: item.notes
        })
      )
    );

    res.status(201).json({
      success: true,
      data: createdItems,
      message: `${createdItems.length} items added to appointment`
    });
  } catch (error) {
    next(error);
  }
});

// Get items for appointment (clinic-isolated)
router.get('/:appointmentId/items', async (req, res, next) => {
  try {
    const { appointmentId } = req.params;

    const AppointmentItem = await getModel(req.clinicDb, 'AppointmentItem');

    const items = await AppointmentItem.findAll({
      where: {
        appointmentId: appointmentId
      }
    });

    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
});

// Generate draft quote from appointment items (clinic-isolated)
router.post('/:appointmentId/generate-quote', async (req, res, next) => {
  try {
    const { appointmentId } = req.params;

    // Get models for this clinic
    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const Document = await getModel(req.clinicDb, 'Document');

    // Verify appointment exists in this clinic
    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, error: { message: 'Appointment not found' } });
    }

    // Check if appointment already has a quote
    const existingQuote = await Document.findOne({
      where: {
        appointmentId: appointmentId,
        documentType: 'quote'
      }
    });

    if (existingQuote && existingQuote.status !== 'cancelled') {
      return res.status(400).json({
        success: false,
        error: { message: 'Appointment already has an active quote. Cancel it first to generate a new one.' }
      });
    }

    // Generate quote from appointment items
    // TODO: Update generateQuoteFromAppointment to work with clinic-specific DB
    // const quote = await generateQuoteFromAppointment(appointmentId, req.clinicDb);

    res.status(201).json({
      success: true,
      data: null, // Placeholder until generateQuoteFromAppointment is updated
      message: 'Draft quote generation coming soon'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

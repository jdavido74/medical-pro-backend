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

const router = express.Router();

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(255).optional(),
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

  onBeforeCreate: async (data, user, clinicDb) => {
    // Check for time conflicts (clinic-isolated)
    const Appointment = await getModel(clinicDb, 'Appointment');

    const conflict = await Appointment.findOne({
      where: {
        practitionerId: data.practitionerId,
        status: { [Op.ne]: 'cancelled' },
        startTime: { [Op.lt]: data.endTime },
        endTime: { [Op.gt]: data.startTime },
        deletedAt: null
      }
    });

    if (conflict) {
      throw new Error('Time slot conflicts with another appointment');
    }

    return data;
  },

  onAfterCreate: async (appointment, user, clinicDb) => {
    logger.info(`Appointment created`, {
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      practitionerId: appointment.practitionerId,
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
    const appointment = await Appointment.findByPk(appointmentId, {
      where: { deletedAt: null }
    });
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
        appointmentId: appointmentId,
        deletedAt: null
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
    const appointment = await Appointment.findByPk(appointmentId, {
      where: { deletedAt: null }
    });
    if (!appointment) {
      return res.status(404).json({ success: false, error: { message: 'Appointment not found' } });
    }

    // Check if appointment already has a quote
    const existingQuote = await Document.findOne({
      where: {
        appointmentId: appointmentId,
        documentType: 'quote',
        deletedAt: null
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

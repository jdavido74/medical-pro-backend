/**
 * Planning Routes
 * Unified appointment planning with machine-based treatments and practitioner consultations
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { Op } = require('sequelize');
const { getModel } = require('../base/ModelFactory');
const planningService = require('../services/planningService');
const stateMachineService = require('../services/appointmentStateMachineService');
const { requirePermission } = require('../middleware/permissions');
const { buildCategoryInheritanceMap, getEffectiveCategories } = require('../utils/categoryInheritance');

// Validation schemas
const createAppointmentSchema = Joi.object({
  category: Joi.string().valid('treatment', 'consultation').required(),
  patientId: Joi.string().uuid().required(),
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  startTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  duration: Joi.number().integer().min(5).max(480).required(),
  // For treatments (allow null for overlappable treatments that don't need a machine)
  machineId: Joi.string().uuid().allow(null).when('category', {
    is: 'treatment',
    then: Joi.optional(),
    otherwise: Joi.optional()
  }),
  treatmentId: Joi.string().uuid().when('category', {
    is: 'treatment',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  // For consultations
  providerId: Joi.string().uuid().when('category', {
    is: 'consultation',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  // Optional
  serviceId: Joi.string().uuid().optional(),
  assistantId: Joi.string().uuid().optional(),
  title: Joi.string().max(255).optional(),
  reason: Joi.string().allow('', null).optional(),
  notes: Joi.string().allow('', null).optional(),
  type: Joi.string().valid('consultation', 'followup', 'emergency', 'checkup', 'procedure', 'teleconsultation', 'specialist', 'vaccination', 'surgery').default('procedure'),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal'),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
  skipPatientOverlapCheck: Joi.boolean().optional()
});

const getSlotsSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  category: Joi.string().valid('treatment', 'consultation').optional(),
  treatmentId: Joi.string().uuid().optional(),
  providerId: Joi.string().uuid().optional(),
  duration: Joi.number().integer().min(5).max(480).optional()
});

const getCalendarSchema = Joi.object({
  startDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  endDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  category: Joi.string().valid('treatment', 'consultation', 'all').default('all'),
  machineId: Joi.string().uuid().optional(),
  providerId: Joi.string().uuid().optional(),
  patientId: Joi.string().uuid().optional(),
  status: Joi.string().optional()
});

// Multi-treatment validation schemas
const getMultiTreatmentSlotsSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  treatments: Joi.array().items(
    Joi.object({
      treatmentId: Joi.string().uuid().required(),
      duration: Joi.number().integer().min(5).max(480).required()
    })
  ).min(1).max(10).required()
});

const createMultiTreatmentSchema = Joi.object({
  patientId: Joi.string().uuid().required(),
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  startTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  providerId: Joi.string().uuid().allow(null, '').optional(),
  assistantId: Joi.string().uuid().allow(null, '').optional(),
  treatments: Joi.array().items(
    Joi.object({
      treatmentId: Joi.string().uuid().required(),
      machineId: Joi.string().uuid().allow(null).optional(),
      duration: Joi.number().integer().min(5).max(480).required(),
      providerId: Joi.string().uuid().allow(null, '').optional(),
      assistantId: Joi.string().uuid().allow(null, '').optional()
    })
  ).min(1).max(10).required(),
  notes: Joi.string().allow('', null).optional(),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal'),
  skipPatientOverlapCheck: Joi.boolean().optional()
});

/**
 * Transform appointment from DB to API format
 */
const transformAppointment = (apt) => {
  if (!apt) return null;
  const data = apt.toJSON ? apt.toJSON() : apt;
  return {
    id: data.id,
    appointmentNumber: data.appointment_number,
    category: data.category,
    type: data.type,
    title: data.title,
    date: data.appointment_date,
    startTime: data.start_time?.substring(0, 5),
    endTime: data.end_time?.substring(0, 5),
    duration: data.duration_minutes,
    status: data.status,
    priority: data.priority,
    reason: data.reason,
    notes: data.notes,
    color: data.color,
    // Linked appointments (multi-treatment)
    linkedAppointmentId: data.linked_appointment_id,
    linkSequence: data.link_sequence,
    isLinked: !!(data.linked_appointment_id || data.link_sequence === 1),
    // Resources
    patientId: data.patient_id,
    patient: data.patient ? {
      id: data.patient.id,
      firstName: data.patient.first_name,
      lastName: data.patient.last_name,
      fullName: `${data.patient.first_name} ${data.patient.last_name}`,
      email: data.patient.email,
      phone: data.patient.phone,
      mobile: data.patient.mobile,
      preferredLanguage: data.patient.preferred_language
    } : undefined,
    machineId: data.machine_id,
    machine: data.machine ? {
      id: data.machine.id,
      name: data.machine.name,
      color: data.machine.color,
      location: data.machine.location
    } : undefined,
    providerId: data.provider_id,
    provider: data.provider ? {
      id: data.provider.id,
      firstName: data.provider.first_name,
      lastName: data.provider.last_name,
      fullName: `${data.provider.first_name} ${data.provider.last_name}`,
      specialty: data.provider.specialties?.[0] || null,
      specialties: data.provider.specialties || []
    } : undefined,
    assistantId: data.assistant_id,
    assistant: data.assistant ? {
      id: data.assistant.id,
      firstName: data.assistant.first_name,
      lastName: data.assistant.last_name,
      fullName: `${data.assistant.first_name} ${data.assistant.last_name}`
    } : undefined,
    serviceId: data.service_id,
    service: data.service ? {
      id: data.service.id,
      title: data.service.title,
      duration: data.service.duration,
      unitPrice: data.service.unit_price != null ? parseFloat(data.service.unit_price) : null,
      taxRate: data.service.tax_rate != null ? parseFloat(data.service.tax_rate) : null,
      isOverlappable: data.service.is_overlappable === true
    } : undefined,
    isOverlappable: data.service?.is_overlappable === true,
    // Workflow fields
    consentStatus: data.consent_status,
    quoteId: data.quote_id,
    invoiceId: data.invoice_id,
    confirmationToken: data.confirmation_token ? true : false, // Don't expose token, just indicate if exists
    // Metadata
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
};

/**
 * GET /planning/slots - Get available time slots
 */
router.get('/slots', async (req, res) => {
  try {
    const { error, value } = getSlotsSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const { date, category, treatmentId, providerId, duration } = value;

    let result;

    if (category === 'treatment' && treatmentId) {
      result = await planningService.getTreatmentSlots(req.clinicDb, treatmentId, date, duration);
    } else if (category === 'consultation' && providerId) {
      result = await planningService.getConsultationSlots(req.clinicDb, providerId, date, duration || 30);
    } else {
      result = await planningService.getAllSlots(req.clinicDb, date, { category, treatmentId, providerId });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[planning] Error getting slots:', error);
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to get available slots' }
    });
  }
});

/**
 * GET /planning/calendar - Get appointments for calendar view
 */
router.get('/calendar', async (req, res) => {
  try {
    const { error, value } = getCalendarSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const { startDate, endDate, category, machineId, providerId, patientId, status } = value;

    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const Patient = await getModel(req.clinicDb, 'Patient');
    const Machine = await getModel(req.clinicDb, 'Machine');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    // Build query
    const where = {
      appointment_date: {
        [Op.between]: [startDate, endDate]
      }
    };

    if (category && category !== 'all') {
      where.category = category;
    }

    if (machineId) {
      where.machine_id = machineId;
    }

    if (providerId) {
      where.provider_id = providerId;
    }

    if (patientId) {
      where.patient_id = patientId;
    }

    if (status) {
      where.status = status;
    }

    const appointments = await Appointment.findAll({
      where,
      include: [
        {
          model: Patient,
          as: 'patient',
          attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'mobile', 'preferred_language']
        },
        {
          model: Machine,
          as: 'machine',
          attributes: ['id', 'name', 'color', 'location'],
          required: false
        },
        {
          model: HealthcareProvider,
          as: 'provider',
          attributes: ['id', 'first_name', 'last_name', 'specialties'],
          required: false
        },
        {
          model: HealthcareProvider,
          as: 'assistant',
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        },
        {
          model: ProductService,
          as: 'service',
          attributes: ['id', 'title', 'duration', 'unit_price', 'tax_rate'],
          required: false
        }
      ],
      order: [['appointment_date', 'ASC'], ['start_time', 'ASC']]
    });

    res.json({
      success: true,
      data: appointments.map(transformAppointment),
      count: appointments.length,
      filters: { startDate, endDate, category, machineId, providerId, patientId }
    });
  } catch (error) {
    console.error('[planning] Error getting calendar:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get calendar data' }
    });
  }
});

/**
 * POST /planning/appointments - Create a new appointment
 */
router.post('/appointments', async (req, res) => {
  try {
    const { error, value } = createAppointmentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const {
      category,
      patientId,
      date,
      startTime,
      duration,
      machineId,
      treatmentId,
      providerId,
      serviceId,
      assistantId,
      title,
      reason,
      notes,
      type,
      priority,
      color
    } = value;

    const Appointment = await getModel(req.clinicDb, 'Appointment');

    // Calculate end time
    const startMinutes = planningService.timeToMinutes(startTime);
    const endTime = planningService.minutesToTime(startMinutes + duration);

    // Check if treatment is overlappable (no machine required)
    let effectiveMachineId = machineId;
    if (category === 'treatment' && (treatmentId || serviceId)) {
      const ProductService = await getModel(req.clinicDb, 'ProductService');
      const treatment = await ProductService.findByPk(treatmentId || serviceId);
      if (treatment && treatment.is_overlappable === true) {
        // Overlappable treatments don't use machines
        effectiveMachineId = null;
      }
    }

    // Check for conflicts
    if (category === 'treatment' && effectiveMachineId) {
      const hasConflict = await Appointment.checkMachineConflict(effectiveMachineId, date, startTime, endTime);
      if (hasConflict) {
        return res.status(409).json({
          success: false,
          error: { message: 'Machine is not available at this time' }
        });
      }
    }

    if (providerId) {
      const providerConflict = await planningService.checkProviderConflicts(
        req.clinicDb, providerId, date, startTime, endTime
      );
      // Consultation conflicts always block.
      // Treatment conflicts only block if the NEW appointment is a consultation.
      const shouldBlock = providerConflict.hasConsultationConflict ||
        (category === 'consultation' && providerConflict.hasTreatmentConflict);
      if (shouldBlock) {
        return res.status(409).json({
          success: false,
          error: {
            message: 'Provider is not available at this time',
            conflicts: providerConflict.conflicts
          }
        });
      }
    }

    // Create appointment
    const appointment = await Appointment.create({
      facility_id: req.user.facilityId || req.user.companyId,
      patient_id: patientId,
      category,
      type: type || (category === 'treatment' ? 'procedure' : 'consultation'),
      appointment_date: date,
      start_time: startTime,
      end_time: endTime,
      duration_minutes: duration,
      machine_id: effectiveMachineId || null,
      provider_id: providerId || null,
      assistant_id: assistantId || null,
      service_id: serviceId || treatmentId || null,
      title: title || null,
      reason: reason || null,
      notes: notes || null,
      priority: priority || 'normal',
      color: color || null,
      status: 'scheduled'
    });

    // Reload with associations
    const Patient = await getModel(req.clinicDb, 'Patient');
    const Machine = await getModel(req.clinicDb, 'Machine');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    await appointment.reload({
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name'] },
        { model: Machine, as: 'machine', attributes: ['id', 'name', 'color', 'location'], required: false },
        { model: HealthcareProvider, as: 'provider', attributes: ['id', 'first_name', 'last_name', 'specialties'], required: false },
        { model: HealthcareProvider, as: 'assistant', attributes: ['id', 'first_name', 'last_name'], required: false },
        { model: ProductService, as: 'service', attributes: ['id', 'title', 'duration', 'unit_price', 'tax_rate', 'is_overlappable'], required: false }
      ]
    });

    // Schedule timed actions for the new appointment (e.g., confirmation email 24h before)
    let scheduledActions = { actions: [], jobs: [] };
    try {
      scheduledActions = await stateMachineService.scheduleTimedActions(
        req.clinicDb,
        appointment,
        req.user?.id
      );
    } catch (scheduleError) {
      console.warn('[planning] Warning: Could not schedule timed actions:', scheduleError.message);
      // Don't fail the request if action scheduling fails
    }

    res.status(201).json({
      success: true,
      data: transformAppointment(appointment),
      message: 'Appointment created successfully',
      scheduledActions: scheduledActions.actions?.length || 0
    });
  } catch (error) {
    console.error('[planning] Error creating appointment:', error);
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to create appointment' }
    });
  }
});

/**
 * GET /planning/appointments/:id - Get appointment details
 */
router.get('/appointments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const Patient = await getModel(req.clinicDb, 'Patient');
    const Machine = await getModel(req.clinicDb, 'Machine');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const appointment = await Appointment.findByPk(id, {
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'email', 'phone'] },
        { model: Machine, as: 'machine', attributes: ['id', 'name', 'color', 'location'], required: false },
        { model: HealthcareProvider, as: 'provider', attributes: ['id', 'first_name', 'last_name', 'specialties'], required: false },
        { model: HealthcareProvider, as: 'assistant', attributes: ['id', 'first_name', 'last_name'], required: false },
        { model: ProductService, as: 'service', attributes: ['id', 'title', 'duration', 'unit_price', 'tax_rate', 'is_overlappable'], required: false }
      ]
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: { message: 'Appointment not found' }
      });
    }

    res.json({
      success: true,
      data: transformAppointment(appointment)
    });
  } catch (error) {
    console.error('[planning] Error getting appointment:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get appointment' }
    });
  }
});

/**
 * PUT /planning/appointments/:id - Update an appointment
 */
router.put('/appointments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const appointment = await Appointment.findByPk(id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: { message: 'Appointment not found' }
      });
    }

    // Update fields
    const updateData = {};
    const allowedFields = [
      'title', 'reason', 'notes', 'priority', 'status', 'color',
      'provider_id', 'assistant_id', 'machine_id', 'service_id'
    ];

    // Map camelCase to snake_case
    const fieldMapping = {
      providerId: 'provider_id',
      assistantId: 'assistant_id',
      machineId: 'machine_id',
      serviceId: 'service_id'
    };

    for (const [key, value] of Object.entries(req.body)) {
      const dbKey = fieldMapping[key] || key;
      if (allowedFields.includes(dbKey) && value !== undefined) {
        updateData[dbKey] = value;
      }
    }

    // Handle date/time changes
    if (req.body.date) {
      updateData.appointment_date = req.body.date;
    }
    if (req.body.startTime) {
      updateData.start_time = req.body.startTime;
      if (req.body.duration) {
        const startMinutes = planningService.timeToMinutes(req.body.startTime);
        updateData.end_time = planningService.minutesToTime(startMinutes + req.body.duration);
        updateData.duration_minutes = req.body.duration;
      }
    }

    await appointment.update(updateData);

    // Reload with associations
    const Patient = await getModel(req.clinicDb, 'Patient');
    const Machine = await getModel(req.clinicDb, 'Machine');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    await appointment.reload({
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name'] },
        { model: Machine, as: 'machine', attributes: ['id', 'name', 'color', 'location'], required: false },
        { model: HealthcareProvider, as: 'provider', attributes: ['id', 'first_name', 'last_name', 'specialties'], required: false },
        { model: HealthcareProvider, as: 'assistant', attributes: ['id', 'first_name', 'last_name'], required: false },
        { model: ProductService, as: 'service', attributes: ['id', 'title', 'duration', 'unit_price', 'tax_rate', 'is_overlappable'], required: false }
      ]
    });

    res.json({
      success: true,
      data: transformAppointment(appointment),
      message: 'Appointment updated successfully'
    });
  } catch (error) {
    console.error('[planning] Error updating appointment:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update appointment' }
    });
  }
});

/**
 * DELETE /planning/appointments/:id - Cancel an appointment
 */
router.delete('/appointments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const appointment = await Appointment.findByPk(id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: { message: 'Appointment not found' }
      });
    }

    // Soft cancel (don't delete)
    await appointment.update({ status: 'cancelled' });

    res.json({
      success: true,
      message: 'Appointment cancelled successfully'
    });
  } catch (error) {
    console.error('[planning] Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to cancel appointment' }
    });
  }
});

/**
 * GET /planning/resources - Get available resources (machines and providers)
 */
router.get('/resources', async (req, res) => {
  try {
    const Machine = await getModel(req.clinicDb, 'Machine');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');

    const [machines, providers] = await Promise.all([
      Machine.findAll({
        where: { is_active: true },
        attributes: ['id', 'name', 'color', 'location'],
        order: [['name', 'ASC']]
      }),
      HealthcareProvider.findAll({
        where: { is_active: true },
        attributes: ['id', 'first_name', 'last_name', 'specialties', 'color', 'role', 'profession'],
        order: [['last_name', 'ASC']]
      })
    ]);

    res.json({
      success: true,
      data: {
        machines: machines.map(m => ({
          id: m.id,
          name: m.name,
          color: m.color,
          location: m.location,
          type: 'machine'
        })),
        providers: providers.map(p => ({
          id: p.id,
          name: `${p.first_name} ${p.last_name}`,
          firstName: p.first_name,
          lastName: p.last_name,
          specialty: p.specialties?.[0] || null, // Get first specialty for backward compatibility
          specialties: p.specialties || [],
          color: p.color,
          role: p.role,
          profession: p.profession,
          type: 'provider'
        }))
      }
    });
  } catch (error) {
    console.error('[planning] Error getting resources:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get resources' }
    });
  }
});

/**
 * GET /planning/treatments - Get treatments available for booking
 */
router.get('/treatments', async (req, res) => {
  try {
    const { search, categoryId } = req.query;
    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const Category = await getModel(req.clinicDb, 'Category');

    // Build where clause
    const where = {
      item_type: 'treatment',
      is_active: true,
      is_family: false // Only variants and standalone items, not families
    };

    // Add search filter
    if (search && search.trim()) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search.trim()}%` } },
        { description: { [Op.iLike]: `%${search.trim()}%` } }
      ];
    }

    // Get treatments with categories
    const treatments = await ProductService.findAll({
      where,
      attributes: ['id', 'title', 'description', 'duration', 'unit_price', 'is_overlappable', 'is_variant', 'parent_id', 'dosage', 'dosage_unit', 'volume'],
      include: [{
        model: Category,
        as: 'categories',
        attributes: ['id', 'name', 'color'],
        through: { attributes: [] },
        required: false
      }],
      order: [['title', 'ASC']]
    });

    // Build category inheritance map for variants without own categories
    const parentCategoriesMap = await buildCategoryInheritanceMap(treatments, getModel, req.clinicDb);

    // Filter by category if specified (including inherited categories)
    let filteredTreatments = treatments;
    if (categoryId) {
      filteredTreatments = treatments.filter(t => {
        const effectiveCats = getEffectiveCategories(t, parentCategoriesMap);
        return effectiveCats.some(c => c.id === categoryId);
      });
    }

    // Group by category for better UX
    const byCategory = {};
    const uncategorized = [];

    filteredTreatments.forEach(t => {
      const effectiveCategories = getEffectiveCategories(t, parentCategoriesMap);
      const treatment = {
        id: t.id,
        title: t.title,
        description: t.description,
        duration: t.duration,
        price: parseFloat(t.unit_price) || 0,
        requiresMachine: !t.is_overlappable,
        isVariant: t.is_variant,
        parentId: t.parent_id,
        dosage: t.dosage,
        dosageUnit: t.dosage_unit,
        volume: t.volume,
        categories: effectiveCategories.map(c => ({ id: c.id, name: c.name, color: c.color }))
      };

      if (effectiveCategories.length > 0) {
        effectiveCategories.forEach(cat => {
          if (!byCategory[cat.id]) {
            byCategory[cat.id] = {
              id: cat.id,
              name: cat.name,
              color: cat.color,
              treatments: []
            };
          }
          // Avoid duplicates in same category
          if (!byCategory[cat.id].treatments.find(tr => tr.id === treatment.id)) {
            byCategory[cat.id].treatments.push(treatment);
          }
        });
      } else {
        uncategorized.push(treatment);
      }
    });

    // Get all categories that have treatments
    const categoriesWithTreatments = Object.values(byCategory).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Add uncategorized if any
    if (uncategorized.length > 0) {
      categoriesWithTreatments.push({
        id: null,
        name: null, // Frontend should display translated "Uncategorized"
        isUncategorized: true,
        color: '#6B7280',
        treatments: uncategorized
      });
    }

    res.json({
      success: true,
      data: {
        treatments: filteredTreatments.map(t => {
          const effectiveCategories = getEffectiveCategories(t, parentCategoriesMap);
          return {
            id: t.id,
            title: t.title,
            description: t.description,
            duration: t.duration,
            price: parseFloat(t.unit_price) || 0,
            requiresMachine: !t.is_overlappable,
            isVariant: t.is_variant,
            dosage: t.dosage,
            dosageUnit: t.dosage_unit,
            volume: t.volume,
            categories: effectiveCategories.map(c => ({ id: c.id, name: c.name, color: c.color }))
          };
        }),
        byCategory: categoriesWithTreatments,
        total: filteredTreatments.length
      }
    });
  } catch (error) {
    console.error('[planning] Error getting treatments:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get treatments' }
    });
  }
});

/**
 * POST /planning/slots/multi-treatment - Get available slots for multiple treatments
 */
router.post('/slots/multi-treatment', async (req, res) => {
  try {
    const { error, value } = getMultiTreatmentSlotsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const { date, treatments } = value;
    const result = await planningService.getMultiTreatmentSlots(req.clinicDb, date, treatments);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[planning] Error getting multi-treatment slots:', error);
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to get multi-treatment slots' }
    });
  }
});

/**
 * POST /planning/appointments/multi-treatment - Create a multi-treatment appointment group
 */
router.post('/appointments/multi-treatment', async (req, res) => {
  const transaction = await req.clinicDb.transaction();

  try {
    const { error, value } = createMultiTreatmentSchema.validate(req.body);
    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const { patientId, date, startTime, treatments, notes, priority, providerId: groupProviderId, assistantId: groupAssistantId } = value;

    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const Patient = await getModel(req.clinicDb, 'Patient');
    const Machine = await getModel(req.clinicDb, 'Machine');
    const ProductService = await getModel(req.clinicDb, 'ProductService');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');

    // Calculate times for each treatment segment
    let currentStartMinutes = planningService.timeToMinutes(startTime);
    const appointments = [];
    let parentId = null;

    for (let i = 0; i < treatments.length; i++) {
      const treatment = treatments[i];
      const segmentStartTime = planningService.minutesToTime(currentStartMinutes);
      const segmentEndTime = planningService.minutesToTime(currentStartMinutes + treatment.duration);

      // Check for machine conflicts (skip for overlappable / no-machine treatments)
      if (treatment.machineId) {
        const hasConflict = await Appointment.checkMachineConflict(
          treatment.machineId,
          date,
          segmentStartTime,
          segmentEndTime
        );

        if (hasConflict) {
          await transaction.rollback();
          return res.status(409).json({
            success: false,
            error: {
              message: `Machine conflict for treatment ${i + 1} at ${segmentStartTime}`,
              treatmentIndex: i
            }
          });
        }
      }

      // Get treatment info for title
      const treatmentInfo = await ProductService.findByPk(treatment.treatmentId);

      // Determine provider and assistant (per-treatment override or group-level)
      const appointmentProviderId = treatment.providerId || groupProviderId || null;
      const appointmentAssistantId = treatment.assistantId || groupAssistantId || null;

      // Create appointment
      const appointmentData = {
        facility_id: req.user.facilityId || req.user.companyId,
        patient_id: patientId,
        category: 'treatment',
        type: 'procedure',
        appointment_date: date,
        start_time: segmentStartTime,
        end_time: segmentEndTime,
        duration_minutes: treatment.duration,
        machine_id: treatment.machineId,
        provider_id: appointmentProviderId,
        assistant_id: appointmentAssistantId,
        service_id: treatment.treatmentId,
        title: treatmentInfo?.title || 'Treatment',
        notes: i === 0 ? notes : null, // Only add notes to first appointment
        priority: priority,
        status: 'scheduled',
        link_sequence: i + 1,
        linked_appointment_id: parentId // null for first, parent ID for others
      };

      const appointment = await Appointment.create(appointmentData, { transaction });

      // Store parent ID after creating first appointment
      if (i === 0) {
        parentId = appointment.id;
      }

      appointments.push(appointment);
      currentStartMinutes += treatment.duration;
    }

    await transaction.commit();

    // Reload appointments with associations
    const reloadedAppointments = await Promise.all(appointments.map(async (apt) => {
      await apt.reload({
        include: [
          { model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name'] },
          { model: Machine, as: 'machine', attributes: ['id', 'name', 'color', 'location'], required: false },
          { model: HealthcareProvider, as: 'provider', attributes: ['id', 'first_name', 'last_name', 'specialties'], required: false },
          { model: HealthcareProvider, as: 'assistant', attributes: ['id', 'first_name', 'last_name'], required: false },
          { model: ProductService, as: 'service', attributes: ['id', 'title', 'duration', 'unit_price', 'tax_rate', 'is_overlappable'], required: false }
        ]
      });
      return transformAppointment(apt);
    }));

    const totalDuration = treatments.reduce((sum, t) => sum + t.duration, 0);

    res.status(201).json({
      success: true,
      data: {
        groupId: parentId,
        appointments: reloadedAppointments,
        totalDuration
      },
      message: 'Multi-treatment appointment created successfully'
    });
  } catch (error) {
    await transaction.rollback();
    console.error('[planning] Error creating multi-treatment appointment:', error);
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to create multi-treatment appointment' }
    });
  }
});

/**
 * GET /planning/appointments/group/:groupId - Get all appointments in a group
 */
router.get('/appointments/group/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;

    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const Patient = await getModel(req.clinicDb, 'Patient');
    const Machine = await getModel(req.clinicDb, 'Machine');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const groupAppointments = await Appointment.findLinkedGroup(groupId, {
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name'] },
        { model: Machine, as: 'machine', attributes: ['id', 'name', 'color', 'location'], required: false },
        { model: HealthcareProvider, as: 'provider', attributes: ['id', 'first_name', 'last_name', 'specialties'], required: false },
        { model: ProductService, as: 'service', attributes: ['id', 'title', 'duration', 'unit_price', 'tax_rate', 'is_overlappable'], required: false }
      ]
    });

    if (groupAppointments.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Appointment group not found' }
      });
    }

    const totalDuration = groupAppointments.reduce((sum, apt) => sum + (apt.duration_minutes || 0), 0);

    res.json({
      success: true,
      data: {
        groupId,
        appointments: groupAppointments.map(transformAppointment),
        totalDuration,
        count: groupAppointments.length
      }
    });
  } catch (error) {
    console.error('[planning] Error getting appointment group:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get appointment group' }
    });
  }
});

/**
 * PUT /planning/appointments/group/:groupId - Update all appointments in a group
 */
router.put('/appointments/group/:groupId', async (req, res) => {
  const transaction = await req.clinicDb.transaction();

  try {
    const { groupId } = req.params;
    const { date, startTime, notes, priority, status, providerId, assistantId, newTreatments } = req.body;

    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const Patient = await getModel(req.clinicDb, 'Patient');
    const Machine = await getModel(req.clinicDb, 'Machine');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const groupAppointments = await Appointment.findLinkedGroup(groupId);

    if (groupAppointments.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: { message: 'Appointment group not found' }
      });
    }

    // If rescheduling (date or time changed), recalculate all times
    if (date || startTime) {
      let currentStartMinutes = startTime
        ? planningService.timeToMinutes(startTime)
        : planningService.timeToMinutes(groupAppointments[0].start_time);

      for (const apt of groupAppointments) {
        const newStartTime = planningService.minutesToTime(currentStartMinutes);
        const newEndTime = planningService.minutesToTime(currentStartMinutes + apt.duration_minutes);

        // Check for machine conflicts (skip for no-machine appointments)
        if (apt.machine_id) {
          const hasConflict = await Appointment.checkMachineConflict(
            apt.machine_id,
            date || apt.appointment_date,
            newStartTime,
            newEndTime,
            apt.id
          );

          if (hasConflict) {
            await transaction.rollback();
            return res.status(409).json({
              success: false,
              error: {
                message: `Machine conflict at ${newStartTime}`,
                appointmentId: apt.id
              }
            });
          }
        }

        const updateData = {
          start_time: newStartTime,
          end_time: newEndTime
        };

        if (date) updateData.appointment_date = date;
        if (notes !== undefined && apt.link_sequence === 1) updateData.notes = notes;
        if (priority) updateData.priority = priority;
        if (status) updateData.status = status;
        if (providerId !== undefined) updateData.provider_id = providerId || null;
        if (assistantId !== undefined) updateData.assistant_id = assistantId || null;

        await apt.update(updateData, { transaction });
        currentStartMinutes += apt.duration_minutes;
      }
    } else {
      // Just update other fields without rescheduling
      for (const apt of groupAppointments) {
        const updateData = {};
        if (notes !== undefined && apt.link_sequence === 1) updateData.notes = notes;
        if (priority) updateData.priority = priority;
        if (status) updateData.status = status;
        if (providerId !== undefined) updateData.provider_id = providerId || null;
        if (assistantId !== undefined) updateData.assistant_id = assistantId || null;

        if (Object.keys(updateData).length > 0) {
          await apt.update(updateData, { transaction });
        }
      }
    }

    // Handle new treatments added to the group
    if (newTreatments && newTreatments.length > 0) {
      const lastApt = groupAppointments[groupAppointments.length - 1];
      let currentStartMinutes = planningService.timeToMinutes(lastApt.end_time);
      const appointmentDate = date || lastApt.appointment_date;
      let maxSequence = Math.max(...groupAppointments.map(a => a.link_sequence || 0));

      for (const treatment of newTreatments) {
        const segmentStartTime = planningService.minutesToTime(currentStartMinutes);
        const segmentEndTime = planningService.minutesToTime(currentStartMinutes + treatment.duration);
        maxSequence++;

        const treatmentInfo = await ProductService.findByPk(treatment.treatmentId);

        await Appointment.create({
          facility_id: groupAppointments[0].facility_id,
          patient_id: groupAppointments[0].patient_id,
          category: 'treatment',
          type: 'procedure',
          appointment_date: appointmentDate,
          start_time: segmentStartTime,
          end_time: segmentEndTime,
          duration_minutes: treatment.duration,
          machine_id: treatment.machineId || null,
          provider_id: providerId !== undefined ? (providerId || null) : (groupAppointments[0].provider_id || null),
          assistant_id: assistantId !== undefined ? (assistantId || null) : (groupAppointments[0].assistant_id || null),
          service_id: treatment.treatmentId,
          title: treatmentInfo?.title || 'Treatment',
          priority: priority || groupAppointments[0].priority,
          status: 'scheduled',
          link_sequence: maxSequence,
          linked_appointment_id: groupId
        }, { transaction });

        currentStartMinutes += treatment.duration;
      }
    }

    await transaction.commit();

    // Reload and return
    const updatedAppointments = await Appointment.findLinkedGroup(groupId, {
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name'] },
        { model: Machine, as: 'machine', attributes: ['id', 'name', 'color', 'location'], required: false },
        { model: HealthcareProvider, as: 'provider', attributes: ['id', 'first_name', 'last_name', 'specialties'], required: false },
        { model: HealthcareProvider, as: 'assistant', attributes: ['id', 'first_name', 'last_name'], required: false },
        { model: ProductService, as: 'service', attributes: ['id', 'title', 'duration', 'unit_price', 'tax_rate', 'is_overlappable'], required: false }
      ]
    });

    res.json({
      success: true,
      data: {
        groupId,
        appointments: updatedAppointments.map(transformAppointment),
        totalDuration: updatedAppointments.reduce((sum, apt) => sum + (apt.duration_minutes || 0), 0)
      },
      message: 'Appointment group updated successfully'
    });
  } catch (error) {
    await transaction.rollback();
    console.error('[planning] Error updating appointment group:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update appointment group' }
    });
  }
});

/**
 * GET /planning/providers/:id/check-availability - Check provider availability for a time slot
 */
router.get('/providers/:id/check-availability', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, startTime, endTime, excludeAppointmentId } = req.query;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: { message: 'date, startTime, and endTime are required' }
      });
    }

    const result = await planningService.checkProviderConflicts(
      req.clinicDb,
      id,
      date,
      startTime,
      endTime,
      excludeAppointmentId || null
    );

    res.json({
      success: true,
      data: {
        available: !result.hasConsultationConflict && !result.hasTreatmentConflict,
        hasConsultationConflict: result.hasConsultationConflict,
        hasTreatmentConflict: result.hasTreatmentConflict,
        conflicts: result.conflicts
      }
    });
  } catch (error) {
    console.error('[planning] Error checking provider availability:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to check provider availability' }
    });
  }
});

/**
 * GET /planning/patients/:id/check-overlap - Check if patient already has appointments overlapping the given time
 */
router.get('/patients/:id/check-overlap', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, startTime, endTime, excludeAppointmentIds, segments } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: { message: 'date is required' }
      });
    }

    // Build segments array from either explicit segments param or single startTime/endTime
    let segmentsArray;
    if (segments) {
      try {
        segmentsArray = JSON.parse(segments);
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: { message: 'segments must be valid JSON' }
        });
      }
    } else if (startTime && endTime) {
      segmentsArray = [{ startTime, endTime }];
    } else {
      return res.status(400).json({
        success: false,
        error: { message: 'Either segments or startTime+endTime are required' }
      });
    }

    // Parse excludeAppointmentIds (comma-separated)
    const excludeIds = excludeAppointmentIds
      ? excludeAppointmentIds.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const result = await planningService.checkPatientConflicts(
      req.clinicDb,
      id,
      date,
      segmentsArray,
      excludeIds
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[planning] Error checking patient overlap:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to check patient overlap' }
    });
  }
});

/**
 * DELETE /planning/appointments/group/:groupId - Cancel all appointments in a group
 */
router.delete('/appointments/group/:groupId', async (req, res) => {
  const transaction = await req.clinicDb.transaction();

  try {
    const { groupId } = req.params;

    const Appointment = await getModel(req.clinicDb, 'Appointment');
    const groupAppointments = await Appointment.findLinkedGroup(groupId);

    if (groupAppointments.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: { message: 'Appointment group not found' }
      });
    }

    // Cancel all appointments in the group
    for (const apt of groupAppointments) {
      await apt.update({ status: 'cancelled' }, { transaction });
    }

    await transaction.commit();

    res.json({
      success: true,
      message: `${groupAppointments.length} appointments cancelled successfully`
    });
  } catch (error) {
    await transaction.rollback();
    console.error('[planning] Error cancelling appointment group:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to cancel appointment group' }
    });
  }
});

module.exports = router;

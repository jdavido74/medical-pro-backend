/**
 * Appointment Actions Routes
 * Manages automated actions for appointments (confirmation emails, consent sending, etc.)
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { getModel } = require('../base/ModelFactory');
const stateMachineService = require('../services/appointmentStateMachineService');
const actionExecutorService = require('../services/appointmentActionExecutorService');
const jobSchedulerService = require('../services/jobSchedulerService');
const { requirePermission } = require('../middleware/permissions');

// Validation schemas
const createActionSchema = Joi.object({
  actionType: Joi.string().valid(
    'confirmation_email',
    'whatsapp_reminder',
    'send_quote',
    'send_consent',
    'prepare_invoice'
  ).required(),
  scheduledAt: Joi.date().iso().optional(),
  requiresValidation: Joi.boolean().default(false),
  metadata: Joi.object().optional()
});

const transitionSchema = Joi.object({
  status: Joi.string().valid(
    'scheduled',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled',
    'no_show'
  ).required(),
  confirmedBy: Joi.string().optional(),
  skipActions: Joi.array().items(Joi.string()).optional()
});

/**
 * Transform action for API response
 */
const transformAction = (action) => {
  if (!action) return null;
  const data = action.toJSON ? action.toJSON() : action;
  return {
    id: data.id,
    appointmentId: data.appointment_id,
    actionType: data.action_type,
    triggerType: data.trigger_type,
    scheduledAt: data.scheduled_at,
    executeBeforeHours: data.execute_before_hours,
    status: data.status,
    requiresValidation: data.requires_validation,
    validatedBy: data.validated_by,
    validatedAt: data.validated_at,
    executedAt: data.executed_at,
    retryCount: data.retry_count,
    maxRetries: data.max_retries,
    lastError: data.last_error,
    resultData: data.result_data,
    relatedQuoteId: data.related_quote_id,
    relatedInvoiceId: data.related_invoice_id,
    relatedConsentRequestId: data.related_consent_request_id,
    metadata: data.metadata,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
};

/**
 * GET /planning/appointments/:id/actions
 * List all actions for an appointment
 */
router.get('/appointments/:id/actions',
  requirePermission('appointments.view'),
  async (req, res) => {
    try {
      const { id: appointmentId } = req.params;
      const { status } = req.query;

      const AppointmentAction = await getModel(req.clinicDb, 'AppointmentAction');

      const where = { appointment_id: appointmentId };
      if (status) {
        where.status = status;
      }

      const actions = await AppointmentAction.findAll({
        where,
        order: [['created_at', 'DESC']]
      });

      res.json({
        success: true,
        data: actions.map(transformAction)
      });
    } catch (error) {
      console.error('Error fetching actions:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /planning/appointments/:id/actions
 * Create a manual action for an appointment
 */
router.post('/appointments/:id/actions',
  requirePermission('appointments.edit'),
  async (req, res) => {
    try {
      const { id: appointmentId } = req.params;
      const { error, value } = createActionSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const action = await stateMachineService.createManualAction(
        req.clinicDb,
        appointmentId,
        value.actionType,
        req.user.id,
        {
          scheduledAt: value.scheduledAt,
          requiresValidation: value.requiresValidation,
          metadata: value.metadata
        }
      );

      res.status(201).json({
        success: true,
        data: transformAction(action)
      });
    } catch (error) {
      console.error('Error creating action:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * PATCH /planning/appointments/:id/actions/:actionId/validate
 * Validate (approve) an action for execution
 */
router.patch('/appointments/:id/actions/:actionId/validate',
  requirePermission('appointments.edit'),
  async (req, res) => {
    try {
      const { actionId } = req.params;

      const action = await stateMachineService.validateAction(
        req.clinicDb,
        actionId,
        req.user.id
      );

      res.json({
        success: true,
        data: transformAction(action)
      });
    } catch (error) {
      console.error('Error validating action:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * PATCH /planning/appointments/:id/actions/:actionId/cancel
 * Cancel an action
 */
router.patch('/appointments/:id/actions/:actionId/cancel',
  requirePermission('appointments.edit'),
  async (req, res) => {
    try {
      const { actionId } = req.params;
      const { reason } = req.body;

      const action = await stateMachineService.cancelAction(
        req.clinicDb,
        actionId,
        reason
      );

      res.json({
        success: true,
        data: transformAction(action)
      });
    } catch (error) {
      console.error('Error cancelling action:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /planning/appointments/:id/actions/:actionId/execute
 * Execute an action immediately
 */
router.post('/appointments/:id/actions/:actionId/execute',
  requirePermission('appointments.edit'),
  async (req, res) => {
    try {
      const { actionId } = req.params;

      // Get clinic settings for context
      const context = {
        clinicName: req.clinic?.name || 'MedicalPro',
        baseUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
      };

      const result = await actionExecutorService.executeAction(
        req.clinicDb,
        actionId,
        context
      );

      res.json({
        success: result.success,
        data: transformAction(result.action),
        result: result.result,
        error: result.error
      });
    } catch (error) {
      console.error('Error executing action:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /planning/appointments/:id/actions/:actionId/retry
 * Retry a failed action
 */
router.post('/appointments/:id/actions/:actionId/retry',
  requirePermission('appointments.edit'),
  async (req, res) => {
    try {
      const { actionId } = req.params;

      const context = {
        clinicName: req.clinic?.name || 'MedicalPro',
        baseUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
      };

      const result = await actionExecutorService.retryAction(
        req.clinicDb,
        actionId,
        context
      );

      res.json({
        success: result.success,
        data: transformAction(result.action),
        result: result.result,
        error: result.error
      });
    } catch (error) {
      console.error('Error retrying action:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /planning/appointments/:id/transition
 * Transition an appointment to a new state
 */
router.post('/appointments/:id/transition',
  requirePermission('appointments.edit'),
  async (req, res) => {
    try {
      const { id: appointmentId } = req.params;
      const { error, value } = transitionSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const result = await stateMachineService.transition(
        req.clinicDb,
        appointmentId,
        value.status,
        req.user.id,
        {
          confirmedBy: value.confirmedBy,
          skipActions: value.skipActions
        }
      );

      // Transform appointment response
      const Appointment = await getModel(req.clinicDb, 'Appointment');
      const Patient = await getModel(req.clinicDb, 'Patient');
      const Machine = await getModel(req.clinicDb, 'Machine');
      const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');

      const appointment = await Appointment.findByPk(appointmentId, {
        include: [
          { model: Patient, as: 'patient' },
          { model: Machine, as: 'machine' },
          { model: HealthcareProvider, as: 'provider' }
        ]
      });

      res.json({
        success: true,
        data: {
          appointment: transformAppointmentBasic(appointment),
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
          createdActions: result.createdActions.map(transformAction)
        }
      });
    } catch (error) {
      console.error('Error transitioning appointment:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /planning/actions/pending
 * Get all pending actions (for dashboard)
 */
router.get('/actions/pending',
  requirePermission('appointments.view'),
  async (req, res) => {
    try {
      const AppointmentAction = await getModel(req.clinicDb, 'AppointmentAction');
      const Appointment = await getModel(req.clinicDb, 'Appointment');
      const Patient = await getModel(req.clinicDb, 'Patient');

      // Set up associations
      if (!AppointmentAction.associations?.appointment) {
        AppointmentAction.belongsTo(Appointment, {
          foreignKey: 'appointment_id',
          as: 'appointment'
        });
      }
      if (!Appointment.associations?.patient) {
        Appointment.belongsTo(Patient, {
          foreignKey: 'patient_id',
          as: 'patient'
        });
      }

      const pendingActions = await AppointmentAction.findAll({
        where: {
          status: ['pending', 'scheduled'],
          requires_validation: true
        },
        include: [{
          model: Appointment,
          as: 'appointment',
          include: [{
            model: Patient,
            as: 'patient'
          }]
        }],
        order: [['created_at', 'ASC']],
        limit: 50
      });

      res.json({
        success: true,
        data: pendingActions.map(action => ({
          ...transformAction(action),
          appointment: action.appointment ? {
            id: action.appointment.id,
            appointmentNumber: action.appointment.appointment_number,
            date: action.appointment.appointment_date,
            startTime: action.appointment.start_time,
            patient: action.appointment.patient ? {
              id: action.appointment.patient.id,
              firstName: action.appointment.patient.first_name,
              lastName: action.appointment.patient.last_name
            } : null
          } : null
        }))
      });
    } catch (error) {
      console.error('Error fetching pending actions:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /planning/actions/summary
 * Get summary of actions for dashboard
 */
router.get('/actions/summary',
  requirePermission('appointments.view'),
  async (req, res) => {
    try {
      const summary = await stateMachineService.getPendingActionsSummary(req.clinicDb);

      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('Error fetching actions summary:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /planning/state-config
 * Get state machine configuration (for UI)
 */
router.get('/state-config',
  requirePermission('appointments.view'),
  async (req, res) => {
    try {
      const config = stateMachineService.getStateConfig();

      res.json({
        success: true,
        data: config
      });
    } catch (error) {
      console.error('Error fetching state config:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /planning/scheduler/process
 * Process due scheduled jobs (internal endpoint)
 */
router.post('/scheduler/process',
  requirePermission('admin'),
  async (req, res) => {
    try {
      const context = {
        clinicName: req.clinic?.name || 'MedicalPro',
        baseUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
      };

      const result = await jobSchedulerService.processDueJobs(req.clinicDb, context);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error processing scheduled jobs:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /planning/scheduler/stats
 * Get job scheduler statistics
 */
router.get('/scheduler/stats',
  requirePermission('appointments.view'),
  async (req, res) => {
    try {
      const stats = await jobSchedulerService.getJobStats(req.clinicDb);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error fetching scheduler stats:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * Helper to transform appointment for basic response
 */
function transformAppointmentBasic(apt) {
  if (!apt) return null;
  const data = apt.toJSON ? apt.toJSON() : apt;
  return {
    id: data.id,
    appointmentNumber: data.appointment_number,
    category: data.category,
    date: data.appointment_date,
    startTime: data.start_time?.substring(0, 5),
    endTime: data.end_time?.substring(0, 5),
    status: data.status,
    consentStatus: data.consent_status,
    patient: data.patient ? {
      id: data.patient.id,
      firstName: data.patient.first_name,
      lastName: data.patient.last_name
    } : null
  };
}

module.exports = router;

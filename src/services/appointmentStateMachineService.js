/**
 * Appointment State Machine Service
 *
 * Manages appointment state transitions and triggers associated actions:
 * - scheduled → confirmed → in_progress → completed
 * - Any state → cancelled / no_show
 *
 * Actions triggered per state:
 * - scheduled: confirmation_email (24h before)
 * - confirmed: send_consent, send_quote
 * - completed: prepare_invoice
 */

const { logger } = require('../utils/logger');
const ModelFactory = require('../base/ModelFactory');

/**
 * State transition rules and actions configuration
 */
const STATE_CONFIG = {
  scheduled: {
    allowedTransitions: ['confirmed', 'in_progress', 'cancelled', 'no_show'],
    onEnter: [],
    timed: [
      {
        action: 'confirmation_email',
        beforeHours: 24,
        requiresValidation: false,
        triggerType: 'automatic'
      }
    ]
  },
  confirmed: {
    allowedTransitions: ['in_progress', 'completed', 'cancelled', 'no_show'],
    onEnter: [
      {
        action: 'send_consent',
        requiresValidation: false,
        triggerType: 'automatic'
      },
      {
        action: 'send_quote',
        requiresValidation: true,
        triggerType: 'automatic'
      }
    ],
    timed: []
  },
  in_progress: {
    allowedTransitions: ['completed', 'cancelled'],
    onEnter: [],
    timed: []
  },
  completed: {
    allowedTransitions: [],
    onEnter: [
      {
        action: 'prepare_invoice',
        requiresValidation: true,
        triggerType: 'automatic'
      }
    ],
    timed: []
  },
  cancelled: {
    allowedTransitions: [],
    onEnter: [],
    timed: []
  },
  no_show: {
    allowedTransitions: [],
    onEnter: [],
    timed: []
  }
};

/**
 * Appointment State Machine Service
 */
class AppointmentStateMachineService {
  constructor() {
    this.stateConfig = STATE_CONFIG;
  }

  /**
   * Get allowed transitions from current state
   * @param {string} currentStatus - Current appointment status
   * @returns {string[]} List of allowed target statuses
   */
  getAllowedTransitions(currentStatus) {
    const config = this.stateConfig[currentStatus];
    return config ? config.allowedTransitions : [];
  }

  /**
   * Check if a transition is allowed
   * @param {string} fromStatus - Current status
   * @param {string} toStatus - Target status
   * @returns {boolean}
   */
  canTransition(fromStatus, toStatus) {
    const allowed = this.getAllowedTransitions(fromStatus);
    return allowed.includes(toStatus);
  }

  /**
   * Transition an appointment to a new state
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {string} appointmentId - Appointment ID
   * @param {string} newStatus - Target status
   * @param {string} userId - User triggering the transition
   * @param {object} options - Additional options
   * @returns {Promise<object>} Result with appointment and created actions
   */
  async transition(clinicDb, appointmentId, newStatus, userId, options = {}) {
    const Appointment = await ModelFactory.getModel(clinicDb, 'Appointment');
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');

    // Load appointment
    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }

    const currentStatus = appointment.status;

    // Check if transition is allowed
    if (!this.canTransition(currentStatus, newStatus)) {
      throw new Error(
        `Invalid transition from '${currentStatus}' to '${newStatus}'. ` +
        `Allowed transitions: ${this.getAllowedTransitions(currentStatus).join(', ') || 'none'}`
      );
    }

    // Update appointment status
    appointment.status = newStatus;

    // Handle specific status updates
    if (newStatus === 'confirmed') {
      appointment.confirmed_at = new Date();
      appointment.confirmed_by = options.confirmedBy || userId;
    }

    await appointment.save();

    logger.info(`Appointment ${appointmentId} transitioned from '${currentStatus}' to '${newStatus}'`, {
      userId,
      previousStatus: currentStatus
    });

    // Create actions for the new state
    const createdActions = await this.createActionsForState(
      clinicDb,
      appointment,
      newStatus,
      userId,
      options
    );

    // Cancel any pending actions that are no longer relevant
    if (['cancelled', 'no_show'].includes(newStatus)) {
      await this.cancelPendingActions(clinicDb, appointmentId);
    }

    return {
      success: true,
      appointment,
      previousStatus: currentStatus,
      newStatus,
      createdActions
    };
  }

  /**
   * Create actions for a state
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Model} appointment - Appointment instance
   * @param {string} status - Current status
   * @param {string} userId - User ID
   * @param {object} options - Options
   * @returns {Promise<Model[]>} Created actions
   */
  async createActionsForState(clinicDb, appointment, status, userId, options = {}) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');

    const stateConfig = this.stateConfig[status];
    if (!stateConfig) {
      return [];
    }

    const createdActions = [];

    // Create onEnter actions
    for (const actionConfig of stateConfig.onEnter) {
      // Check if action should be skipped based on options
      if (options.skipActions && options.skipActions.includes(actionConfig.action)) {
        continue;
      }

      const action = await AppointmentAction.create({
        appointment_id: appointment.id,
        action_type: actionConfig.action,
        trigger_type: actionConfig.triggerType,
        status: actionConfig.requiresValidation ? 'pending' : 'scheduled',
        requires_validation: actionConfig.requiresValidation,
        created_by: userId,
        metadata: {
          sourceState: status,
          createdAutomatically: true
        }
      });

      createdActions.push(action);

      logger.info(`Created action '${actionConfig.action}' for appointment ${appointment.id}`, {
        actionId: action.id,
        requiresValidation: actionConfig.requiresValidation
      });
    }

    return createdActions;
  }

  /**
   * Schedule timed actions for an appointment
   * Called when appointment is created with 'scheduled' status
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Model} appointment - Appointment instance
   * @param {string} userId - User ID
   * @returns {Promise<object>} Created actions and jobs
   */
  async scheduleTimedActions(clinicDb, appointment, userId) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');
    const ScheduledJob = await ModelFactory.getModel(clinicDb, 'ScheduledJob');

    const status = appointment.status;
    const stateConfig = this.stateConfig[status];

    if (!stateConfig || !stateConfig.timed.length) {
      return { actions: [], jobs: [] };
    }

    const createdActions = [];
    const createdJobs = [];

    // Calculate appointment datetime
    const appointmentDateTime = new Date(`${appointment.appointment_date}T${appointment.start_time}`);

    for (const actionConfig of stateConfig.timed) {
      // Calculate scheduled time (beforeHours before appointment)
      const scheduledAt = new Date(appointmentDateTime.getTime() - actionConfig.beforeHours * 60 * 60 * 1000);

      // Don't schedule if the time has already passed
      if (scheduledAt <= new Date()) {
        logger.warn(`Skipping timed action '${actionConfig.action}' - scheduled time already passed`, {
          appointmentId: appointment.id,
          scheduledAt
        });
        continue;
      }

      // Create the action
      const action = await AppointmentAction.create({
        appointment_id: appointment.id,
        action_type: actionConfig.action,
        trigger_type: actionConfig.triggerType,
        status: 'scheduled',
        scheduled_at: scheduledAt,
        execute_before_hours: actionConfig.beforeHours,
        requires_validation: actionConfig.requiresValidation,
        created_by: userId,
        metadata: {
          sourceState: status,
          createdAutomatically: true,
          isTimedAction: true
        }
      });

      createdActions.push(action);

      // Create a scheduled job to execute this action
      const job = await ScheduledJob.schedule(
        'execute_action',
        scheduledAt,
        { actionId: action.id, appointmentId: appointment.id },
        {
          referenceId: action.id,
          referenceType: 'appointment_action'
        }
      );

      createdJobs.push(job);

      logger.info(`Scheduled timed action '${actionConfig.action}' for appointment ${appointment.id}`, {
        actionId: action.id,
        scheduledAt,
        beforeHours: actionConfig.beforeHours
      });
    }

    return { actions: createdActions, jobs: createdJobs };
  }

  /**
   * Cancel all pending actions for an appointment
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {string} appointmentId - Appointment ID
   */
  async cancelPendingActions(clinicDb, appointmentId) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');
    const ScheduledJob = await ModelFactory.getModel(clinicDb, 'ScheduledJob');

    // Cancel pending/scheduled actions
    const [updatedCount] = await AppointmentAction.update(
      { status: 'cancelled', metadata: { cancelledReason: 'appointment_cancelled' } },
      {
        where: {
          appointment_id: appointmentId,
          status: ['pending', 'scheduled']
        }
      }
    );

    // Cancel related scheduled jobs
    await ScheduledJob.cancelForReference(appointmentId, 'appointment');

    logger.info(`Cancelled ${updatedCount} pending actions for appointment ${appointmentId}`);

    return updatedCount;
  }

  /**
   * Validate an action (approve for execution)
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {string} actionId - Action ID
   * @param {string} userId - User validating
   * @returns {Promise<Model>} Updated action
   */
  async validateAction(clinicDb, actionId, userId) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');

    const action = await AppointmentAction.findByPk(actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    if (!action.requires_validation) {
      throw new Error('This action does not require validation');
    }

    if (action.status !== 'pending') {
      throw new Error(`Cannot validate action in status '${action.status}'`);
    }

    await action.validate(userId);

    logger.info(`Action ${actionId} validated by user ${userId}`);

    return action;
  }

  /**
   * Cancel an action
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {string} actionId - Action ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Model>} Updated action
   */
  async cancelAction(clinicDb, actionId, reason) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');

    const action = await AppointmentAction.findByPk(actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    if (['completed', 'cancelled'].includes(action.status)) {
      throw new Error(`Cannot cancel action in status '${action.status}'`);
    }

    await action.cancel(reason);

    logger.info(`Action ${actionId} cancelled`, { reason });

    return action;
  }

  /**
   * Create a manual action for an appointment
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {string} appointmentId - Appointment ID
   * @param {string} actionType - Type of action
   * @param {string} userId - User creating the action
   * @param {object} options - Additional options
   * @returns {Promise<Model>} Created action
   */
  async createManualAction(clinicDb, appointmentId, actionType, userId, options = {}) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');
    const Appointment = await ModelFactory.getModel(clinicDb, 'Appointment');

    // Verify appointment exists
    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }

    const action = await AppointmentAction.create({
      appointment_id: appointmentId,
      action_type: actionType,
      trigger_type: 'manual',
      status: options.requiresValidation ? 'pending' : 'scheduled',
      requires_validation: options.requiresValidation || false,
      scheduled_at: options.scheduledAt,
      created_by: userId,
      metadata: {
        createdManually: true,
        ...options.metadata
      }
    });

    logger.info(`Created manual action '${actionType}' for appointment ${appointmentId}`, {
      actionId: action.id,
      userId
    });

    return action;
  }

  /**
   * Get pending actions summary for dashboard
   * @param {Sequelize} clinicDb - Clinic database connection
   * @returns {Promise<object>} Summary of pending actions
   */
  async getPendingActionsSummary(clinicDb) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');
    const { Op } = require('sequelize');

    const pendingValidation = await AppointmentAction.count({
      where: {
        requires_validation: true,
        status: 'pending'
      }
    });

    const scheduled = await AppointmentAction.count({
      where: {
        status: 'scheduled'
      }
    });

    const failed = await AppointmentAction.count({
      where: {
        status: 'failed'
      }
    });

    const upcoming = await AppointmentAction.count({
      where: {
        status: { [Op.in]: ['pending', 'scheduled'] },
        scheduled_at: {
          [Op.lte]: new Date(Date.now() + 24 * 60 * 60 * 1000) // Next 24 hours
        }
      }
    });

    return {
      pendingValidation,
      scheduled,
      failed,
      upcomingIn24h: upcoming
    };
  }

  /**
   * Get state configuration
   * @returns {object} State configuration
   */
  getStateConfig() {
    return this.stateConfig;
  }
}

// Export singleton
module.exports = new AppointmentStateMachineService();

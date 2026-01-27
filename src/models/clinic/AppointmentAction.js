/**
 * Clinic AppointmentAction Model
 *
 * Tracks automated actions triggered by appointment state transitions:
 * - confirmation_email: Send confirmation email 24h before
 * - whatsapp_reminder: Send WhatsApp reminder
 * - send_quote: Generate and send quote
 * - send_consent: Send consent forms for signing
 * - prepare_invoice: Create invoice draft
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes, Op } = require('sequelize');

/**
 * Action types enum
 */
const ACTION_TYPES = {
  CONFIRMATION_EMAIL: 'confirmation_email',
  WHATSAPP_REMINDER: 'whatsapp_reminder',
  SEND_QUOTE: 'send_quote',
  SEND_CONSENT: 'send_consent',
  PREPARE_INVOICE: 'prepare_invoice'
};

/**
 * Action status enum
 */
const ACTION_STATUS = {
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  VALIDATED: 'validated'
};

/**
 * Trigger types enum
 */
const TRIGGER_TYPES = {
  AUTOMATIC: 'automatic',
  MANUAL: 'manual',
  PATIENT_ACTION: 'patient_action'
};

/**
 * Create AppointmentAction model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} AppointmentAction model configured for the clinic database
 */
function createAppointmentActionModel(clinicDb) {
  const AppointmentAction = ClinicBaseModel.create(clinicDb, 'AppointmentAction', {
    // Appointment relationship
    appointment_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'appointments',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    // Action type
    action_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [Object.values(ACTION_TYPES)]
      }
    },

    trigger_type: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: TRIGGER_TYPES.AUTOMATIC,
      validate: {
        isIn: [Object.values(TRIGGER_TYPES)]
      }
    },

    // Scheduling
    scheduled_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    execute_before_hours: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    // Status
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: ACTION_STATUS.PENDING,
      validate: {
        isIn: [Object.values(ACTION_STATUS)]
      }
    },

    // Validation
    requires_validation: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    validated_by: {
      type: DataTypes.UUID,
      allowNull: true
    },
    validated_at: {
      type: DataTypes.DATE,
      allowNull: true
    },

    // Execution
    executed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    retry_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    max_retries: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 3
    },
    last_error: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    result_data: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    },

    // Related documents
    related_quote_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    related_invoice_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    related_consent_request_id: {
      type: DataTypes.UUID,
      allowNull: true
    },

    // Metadata
    metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    },

    // Audit
    created_by: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    tableName: 'appointment_actions',
    indexes: [
      { fields: ['appointment_id'] },
      { fields: ['status'] },
      { fields: ['action_type'] },
      { fields: ['scheduled_at'] }
    ]
  });

  // Instance methods

  /**
   * Mark action as validated
   */
  AppointmentAction.prototype.validate = async function(userId) {
    this.status = ACTION_STATUS.VALIDATED;
    this.validated_by = userId;
    this.validated_at = new Date();
    return await this.save();
  };

  /**
   * Mark action as cancelled
   */
  AppointmentAction.prototype.cancel = async function(reason) {
    this.status = ACTION_STATUS.CANCELLED;
    if (reason) {
      this.metadata = { ...this.metadata, cancelReason: reason };
    }
    return await this.save();
  };

  /**
   * Mark action as in progress
   */
  AppointmentAction.prototype.startExecution = async function() {
    this.status = ACTION_STATUS.IN_PROGRESS;
    return await this.save();
  };

  /**
   * Mark action as completed
   */
  AppointmentAction.prototype.complete = async function(resultData = {}) {
    this.status = ACTION_STATUS.COMPLETED;
    this.executed_at = new Date();
    this.result_data = { ...this.result_data, ...resultData };
    return await this.save();
  };

  /**
   * Mark action as failed
   */
  AppointmentAction.prototype.fail = async function(error) {
    this.retry_count += 1;
    this.last_error = error.message || String(error);

    if (this.retry_count >= this.max_retries) {
      this.status = ACTION_STATUS.FAILED;
    } else {
      this.status = ACTION_STATUS.PENDING; // Will be retried
    }

    return await this.save();
  };

  /**
   * Check if action can be executed
   */
  AppointmentAction.prototype.canExecute = function() {
    // Can execute if pending or scheduled
    if (![ACTION_STATUS.PENDING, ACTION_STATUS.SCHEDULED].includes(this.status)) {
      return false;
    }

    // If requires validation, must be validated first
    if (this.requires_validation && this.status !== ACTION_STATUS.VALIDATED) {
      return false;
    }

    // Check scheduled time if set
    if (this.scheduled_at && new Date(this.scheduled_at) > new Date()) {
      return false;
    }

    return true;
  };

  /**
   * Check if action can be retried
   */
  AppointmentAction.prototype.canRetry = function() {
    return this.status === ACTION_STATUS.FAILED && this.retry_count < this.max_retries;
  };

  // Static methods

  /**
   * Find pending actions for an appointment
   */
  AppointmentAction.findPendingByAppointment = async function(appointmentId, options = {}) {
    return await this.findAll({
      where: {
        appointment_id: appointmentId,
        status: { [Op.in]: [ACTION_STATUS.PENDING, ACTION_STATUS.SCHEDULED] },
        ...options.where
      },
      order: [['created_at', 'ASC']],
      ...options
    });
  };

  /**
   * Find actions requiring validation
   */
  AppointmentAction.findPendingValidation = async function(options = {}) {
    return await this.findAll({
      where: {
        requires_validation: true,
        status: ACTION_STATUS.PENDING,
        ...options.where
      },
      order: [['created_at', 'ASC']],
      ...options
    });
  };

  /**
   * Find actions ready for execution
   */
  AppointmentAction.findReadyForExecution = async function(options = {}) {
    const now = new Date();
    return await this.findAll({
      where: {
        status: { [Op.in]: [ACTION_STATUS.PENDING, ACTION_STATUS.SCHEDULED, ACTION_STATUS.VALIDATED] },
        [Op.or]: [
          { scheduled_at: null },
          { scheduled_at: { [Op.lte]: now } }
        ],
        [Op.and]: [
          {
            [Op.or]: [
              { requires_validation: false },
              { validated_at: { [Op.ne]: null } }
            ]
          }
        ],
        ...options.where
      },
      order: [['scheduled_at', 'ASC'], ['created_at', 'ASC']],
      ...options
    });
  };

  /**
   * Find failed actions that can be retried
   */
  AppointmentAction.findRetryable = async function(options = {}) {
    return await this.findAll({
      where: {
        status: ACTION_STATUS.FAILED,
        ...options.where
      },
      order: [['created_at', 'ASC']],
      ...options
    }).then(actions => actions.filter(a => a.retry_count < a.max_retries));
  };

  /**
   * Find actions by type
   */
  AppointmentAction.findByType = async function(actionType, options = {}) {
    return await this.findAll({
      where: {
        action_type: actionType,
        ...options.where
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  /**
   * Count pending actions for dashboard
   */
  AppointmentAction.countPending = async function(whereClause = {}) {
    return await this.count({
      where: {
        status: { [Op.in]: [ACTION_STATUS.PENDING, ACTION_STATUS.SCHEDULED] },
        ...whereClause
      }
    });
  };

  /**
   * Count actions requiring validation
   */
  AppointmentAction.countPendingValidation = async function(whereClause = {}) {
    return await this.count({
      where: {
        requires_validation: true,
        status: ACTION_STATUS.PENDING,
        ...whereClause
      }
    });
  };

  // Attach enums to model
  AppointmentAction.ACTION_TYPES = ACTION_TYPES;
  AppointmentAction.ACTION_STATUS = ACTION_STATUS;
  AppointmentAction.TRIGGER_TYPES = TRIGGER_TYPES;

  return AppointmentAction;
}

module.exports = createAppointmentActionModel;

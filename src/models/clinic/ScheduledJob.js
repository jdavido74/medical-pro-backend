/**
 * Clinic ScheduledJob Model
 *
 * Generic job scheduling table for background tasks:
 * - Execute timed actions (reminders, notifications)
 * - Retry failed jobs
 * - Track job execution history
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes, Op } = require('sequelize');

/**
 * Job types enum
 */
const JOB_TYPES = {
  APPOINTMENT_REMINDER: 'appointment_reminder',
  APPOINTMENT_CONFIRMATION: 'appointment_confirmation',
  SEND_CONSENT: 'send_consent',
  SEND_QUOTE: 'send_quote',
  PREPARE_INVOICE: 'prepare_invoice',
  EXECUTE_ACTION: 'execute_action'
};

/**
 * Job status enum
 */
const JOB_STATUS = {
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Create ScheduledJob model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} ScheduledJob model configured for the clinic database
 */
function createScheduledJobModel(clinicDb) {
  const ScheduledJob = ClinicBaseModel.create(clinicDb, 'ScheduledJob', {
    // Job identification
    job_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [Object.values(JOB_TYPES)]
      }
    },

    // Reference to related entity
    reference_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    reference_type: {
      type: DataTypes.STRING(50),
      allowNull: true
    },

    // Scheduling
    execute_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    executed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },

    // Status
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: JOB_STATUS.SCHEDULED,
      validate: {
        isIn: [Object.values(JOB_STATUS)]
      }
    },

    // Retry handling
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

    // Data
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    },
    result: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    },

    // Tenant isolation (clinic identifier)
    clinic_id: {
      type: DataTypes.STRING(100),
      allowNull: true
    }
  }, {
    tableName: 'scheduled_jobs',
    updatedAt: false, // No updated_at for jobs
    indexes: [
      { fields: ['execute_at'] },
      { fields: ['status'] },
      { fields: ['job_type'] },
      { fields: ['reference_id', 'reference_type'] },
      { fields: ['clinic_id'] }
    ]
  });

  // Instance methods

  /**
   * Mark job as in progress
   */
  ScheduledJob.prototype.startExecution = async function() {
    this.status = JOB_STATUS.IN_PROGRESS;
    return await this.save();
  };

  /**
   * Mark job as completed
   */
  ScheduledJob.prototype.complete = async function(resultData = {}) {
    this.status = JOB_STATUS.COMPLETED;
    this.executed_at = new Date();
    this.result = resultData;
    return await this.save();
  };

  /**
   * Mark job as failed
   */
  ScheduledJob.prototype.fail = async function(error) {
    this.retry_count += 1;
    this.last_error = error.message || String(error);

    if (this.retry_count >= this.max_retries) {
      this.status = JOB_STATUS.FAILED;
    } else {
      this.status = JOB_STATUS.SCHEDULED; // Will be retried
      // Retry in 5 minutes
      this.execute_at = new Date(Date.now() + 5 * 60 * 1000);
    }

    return await this.save();
  };

  /**
   * Cancel job
   */
  ScheduledJob.prototype.cancel = async function() {
    this.status = JOB_STATUS.CANCELLED;
    return await this.save();
  };

  /**
   * Check if job can be executed
   */
  ScheduledJob.prototype.canExecute = function() {
    if (this.status !== JOB_STATUS.SCHEDULED) {
      return false;
    }

    return new Date(this.execute_at) <= new Date();
  };

  // Static methods

  /**
   * Find jobs ready for execution
   */
  ScheduledJob.findDueJobs = async function(options = {}) {
    const now = new Date();
    return await this.findAll({
      where: {
        status: JOB_STATUS.SCHEDULED,
        execute_at: { [Op.lte]: now },
        ...options.where
      },
      order: [['execute_at', 'ASC']],
      limit: options.limit || 100,
      ...options
    });
  };

  /**
   * Find jobs for a reference
   */
  ScheduledJob.findByReference = async function(referenceId, referenceType, options = {}) {
    return await this.findAll({
      where: {
        reference_id: referenceId,
        reference_type: referenceType,
        ...options.where
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  /**
   * Cancel all pending jobs for a reference
   */
  ScheduledJob.cancelForReference = async function(referenceId, referenceType) {
    return await this.update(
      { status: JOB_STATUS.CANCELLED },
      {
        where: {
          reference_id: referenceId,
          reference_type: referenceType,
          status: JOB_STATUS.SCHEDULED
        }
      }
    );
  };

  /**
   * Find failed jobs for retry
   */
  ScheduledJob.findFailedForRetry = async function(options = {}) {
    return await this.findAll({
      where: {
        status: JOB_STATUS.FAILED,
        ...options.where
      },
      ...options
    }).then(jobs => jobs.filter(j => j.retry_count < j.max_retries));
  };

  /**
   * Count pending jobs
   */
  ScheduledJob.countPending = async function(whereClause = {}) {
    return await this.count({
      where: {
        status: JOB_STATUS.SCHEDULED,
        ...whereClause
      }
    });
  };

  /**
   * Create a scheduled job
   */
  ScheduledJob.schedule = async function(jobType, executeAt, payload = {}, options = {}) {
    return await this.create({
      job_type: jobType,
      execute_at: executeAt,
      payload,
      reference_id: options.referenceId,
      reference_type: options.referenceType,
      clinic_id: options.clinicId,
      max_retries: options.maxRetries || 3
    });
  };

  // Attach enums to model
  ScheduledJob.JOB_TYPES = JOB_TYPES;
  ScheduledJob.JOB_STATUS = JOB_STATUS;

  return ScheduledJob;
}

module.exports = createScheduledJobModel;

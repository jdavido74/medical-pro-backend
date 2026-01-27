/**
 * Job Scheduler Service
 *
 * Handles execution of scheduled jobs:
 * - Polls for due jobs
 * - Executes jobs based on type
 * - Handles retries and failures
 *
 * Can be triggered by:
 * - Internal node-cron (if enabled)
 * - External endpoint /api/internal/scheduler/process
 * - Manual invocation
 */

const { logger } = require('../utils/logger');
const ModelFactory = require('../base/ModelFactory');
const actionExecutorService = require('./appointmentActionExecutorService');

/**
 * Job Scheduler Service
 */
class JobSchedulerService {
  constructor() {
    this.isProcessing = false;
    this.cronJob = null;
  }

  /**
   * Start the internal cron scheduler
   * Runs every minute by default
   * @param {string} cronExpression - Cron expression (default: every minute)
   */
  startCron(cronExpression = '* * * * *') {
    if (process.env.ENABLE_JOB_SCHEDULER !== 'true') {
      logger.info('Job scheduler cron is disabled. Set ENABLE_JOB_SCHEDULER=true to enable.');
      return;
    }

    try {
      const cron = require('node-cron');

      this.cronJob = cron.schedule(cronExpression, async () => {
        await this.processAllClinics();
      });

      logger.info(`Job scheduler cron started with expression: ${cronExpression}`);
    } catch (error) {
      logger.error('Failed to start job scheduler cron:', error);
    }
  }

  /**
   * Stop the cron scheduler
   */
  stopCron() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('Job scheduler cron stopped');
    }
  }

  /**
   * Process jobs for all clinics
   * Used when processing from a central scheduler
   */
  async processAllClinics() {
    if (this.isProcessing) {
      logger.warn('Job scheduler is already processing, skipping this cycle');
      return;
    }

    this.isProcessing = true;

    try {
      // In a multi-tenant setup, we'd iterate over all clinic databases
      // For now, this is a placeholder that would be called with specific clinicDb
      logger.debug('Job scheduler cycle started');

      // This would typically be called per-clinic from the route handler
      // which has access to the specific clinic database connection

    } catch (error) {
      logger.error('Error in job scheduler cycle:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process due jobs for a specific clinic
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {object} context - Execution context
   * @returns {Promise<object>} Processing results
   */
  async processDueJobs(clinicDb, context = {}) {
    const ScheduledJob = await ModelFactory.getModel(clinicDb, 'ScheduledJob');

    // Find all due jobs
    const dueJobs = await ScheduledJob.findDueJobs({ limit: 50 });

    if (dueJobs.length === 0) {
      return {
        processed: 0,
        successful: 0,
        failed: 0,
        results: []
      };
    }

    logger.info(`Found ${dueJobs.length} due jobs to process`);

    const results = [];

    for (const job of dueJobs) {
      const result = await this.executeJob(clinicDb, job, context);
      results.push(result);
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    logger.info(`Processed ${dueJobs.length} jobs: ${successful} successful, ${failed} failed`);

    return {
      processed: dueJobs.length,
      successful,
      failed,
      results
    };
  }

  /**
   * Execute a single job
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {Model} job - ScheduledJob instance
   * @param {object} context - Execution context
   */
  async executeJob(clinicDb, job, context = {}) {
    try {
      // Mark as in progress
      await job.startExecution();

      let result;

      switch (job.job_type) {
        case 'execute_action':
          result = await this.executeActionJob(clinicDb, job, context);
          break;

        case 'appointment_reminder':
          result = await this.executeReminderJob(clinicDb, job, context);
          break;

        case 'appointment_confirmation':
          result = await this.executeConfirmationJob(clinicDb, job, context);
          break;

        default:
          throw new Error(`Unknown job type: ${job.job_type}`);
      }

      // Mark as completed
      await job.complete(result);

      return {
        success: true,
        jobId: job.id,
        jobType: job.job_type,
        result
      };
    } catch (error) {
      // Mark as failed (will auto-retry if under max_retries)
      await job.fail(error);

      logger.error(`Job ${job.id} failed:`, error);

      return {
        success: false,
        jobId: job.id,
        jobType: job.job_type,
        error: error.message
      };
    }
  }

  /**
   * Execute an action job
   * Triggers the action executor service
   */
  async executeActionJob(clinicDb, job, context) {
    const { actionId, appointmentId } = job.payload;

    if (!actionId) {
      throw new Error('Missing actionId in job payload');
    }

    const result = await actionExecutorService.executeAction(clinicDb, actionId, context);

    return {
      actionId,
      appointmentId,
      actionResult: result
    };
  }

  /**
   * Execute a reminder job
   * Sends appointment reminder
   */
  async executeReminderJob(clinicDb, job, context) {
    const { appointmentId, channel } = job.payload;

    if (!appointmentId) {
      throw new Error('Missing appointmentId in job payload');
    }

    // Create and execute a reminder action
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');

    const action = await AppointmentAction.create({
      appointment_id: appointmentId,
      action_type: channel === 'whatsapp' ? 'whatsapp_reminder' : 'confirmation_email',
      trigger_type: 'automatic',
      status: 'scheduled',
      metadata: {
        fromJob: job.id
      }
    });

    const result = await actionExecutorService.executeAction(clinicDb, action.id, context);

    return {
      appointmentId,
      channel: channel || 'email',
      actionId: action.id,
      result
    };
  }

  /**
   * Execute a confirmation request job
   */
  async executeConfirmationJob(clinicDb, job, context) {
    const { appointmentId } = job.payload;

    if (!appointmentId) {
      throw new Error('Missing appointmentId in job payload');
    }

    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');

    const action = await AppointmentAction.create({
      appointment_id: appointmentId,
      action_type: 'confirmation_email',
      trigger_type: 'automatic',
      status: 'scheduled',
      metadata: {
        fromJob: job.id
      }
    });

    const result = await actionExecutorService.executeAction(clinicDb, action.id, context);

    return {
      appointmentId,
      actionId: action.id,
      result
    };
  }

  /**
   * Schedule a new job
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {string} jobType - Type of job
   * @param {Date} executeAt - When to execute
   * @param {object} payload - Job payload
   * @param {object} options - Additional options
   */
  async scheduleJob(clinicDb, jobType, executeAt, payload = {}, options = {}) {
    const ScheduledJob = await ModelFactory.getModel(clinicDb, 'ScheduledJob');

    const job = await ScheduledJob.schedule(jobType, executeAt, payload, {
      referenceId: options.referenceId,
      referenceType: options.referenceType,
      clinicId: options.clinicId,
      maxRetries: options.maxRetries
    });

    logger.info(`Scheduled job '${jobType}' for ${executeAt.toISOString()}`, {
      jobId: job.id,
      referenceId: options.referenceId
    });

    return job;
  }

  /**
   * Cancel jobs for a reference
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {string} referenceId - Reference ID
   * @param {string} referenceType - Reference type
   */
  async cancelJobsForReference(clinicDb, referenceId, referenceType) {
    const ScheduledJob = await ModelFactory.getModel(clinicDb, 'ScheduledJob');

    const result = await ScheduledJob.cancelForReference(referenceId, referenceType);

    logger.info(`Cancelled jobs for ${referenceType} ${referenceId}`, {
      cancelledCount: result[0]
    });

    return result;
  }

  /**
   * Get job statistics
   * @param {Sequelize} clinicDb - Clinic database connection
   */
  async getJobStats(clinicDb) {
    const ScheduledJob = await ModelFactory.getModel(clinicDb, 'ScheduledJob');
    const { Op } = require('sequelize');

    const scheduled = await ScheduledJob.count({
      where: { status: 'scheduled' }
    });

    const inProgress = await ScheduledJob.count({
      where: { status: 'in_progress' }
    });

    const failed = await ScheduledJob.count({
      where: { status: 'failed' }
    });

    const completedToday = await ScheduledJob.count({
      where: {
        status: 'completed',
        executed_at: {
          [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    });

    const dueNow = await ScheduledJob.count({
      where: {
        status: 'scheduled',
        execute_at: { [Op.lte]: new Date() }
      }
    });

    return {
      scheduled,
      inProgress,
      failed,
      completedToday,
      dueNow
    };
  }

  /**
   * Retry failed jobs
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {object} context - Execution context
   */
  async retryFailedJobs(clinicDb, context = {}) {
    const ScheduledJob = await ModelFactory.getModel(clinicDb, 'ScheduledJob');

    const failedJobs = await ScheduledJob.findFailedForRetry();
    const results = [];

    for (const job of failedJobs) {
      // Reset for retry
      job.status = 'scheduled';
      job.execute_at = new Date(Date.now() + 5 * 60 * 1000); // Retry in 5 minutes
      await job.save();

      results.push({
        jobId: job.id,
        rescheduledTo: job.execute_at
      });
    }

    return {
      retriedCount: results.length,
      results
    };
  }

  /**
   * Clean up old completed/cancelled jobs
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {number} daysOld - Delete jobs older than this many days
   */
  async cleanupOldJobs(clinicDb, daysOld = 30) {
    const ScheduledJob = await ModelFactory.getModel(clinicDb, 'ScheduledJob');
    const { Op } = require('sequelize');

    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const deletedCount = await ScheduledJob.destroy({
      where: {
        status: { [Op.in]: ['completed', 'cancelled'] },
        created_at: { [Op.lt]: cutoffDate }
      }
    });

    logger.info(`Cleaned up ${deletedCount} old jobs (older than ${daysOld} days)`);

    return { deletedCount };
  }
}

// Export singleton
module.exports = new JobSchedulerService();

/**
 * Appointment Action Executor Service
 *
 * Executes actions triggered by the appointment state machine:
 * - confirmation_email: Send appointment confirmation request
 * - send_consent: Send consent forms for signature
 * - send_quote: Generate and send quote
 * - prepare_invoice: Create invoice draft
 */

const { logger } = require('../utils/logger');
const ModelFactory = require('../base/ModelFactory');
const messagingService = require('./messagingService');
const { TEMPLATE_TYPES } = require('./messagingService');

/**
 * Action Executor Service
 */
class AppointmentActionExecutorService {
  /**
   * Execute an action
   * @param {Sequelize} clinicDb - Clinic database connection
   * @param {string} actionId - Action ID
   * @param {object} context - Execution context (clinicSettings, baseUrl, etc.)
   * @returns {Promise<object>} Execution result
   */
  async executeAction(clinicDb, actionId, context = {}) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');

    const action = await AppointmentAction.findByPk(actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    // Check if action can be executed
    if (!action.canExecute()) {
      const reason = action.requires_validation && !action.validated_at
        ? 'Action requires validation'
        : `Action status is '${action.status}'`;
      throw new Error(`Cannot execute action: ${reason}`);
    }

    // Mark as in progress
    await action.startExecution();

    try {
      let result;

      switch (action.action_type) {
        case 'confirmation_email':
          result = await this.executeConfirmationEmail(clinicDb, action, context);
          break;

        case 'send_consent':
          result = await this.executeSendConsent(clinicDb, action, context);
          break;

        case 'send_quote':
          result = await this.executeSendQuote(clinicDb, action, context);
          break;

        case 'prepare_invoice':
          result = await this.executePrepareInvoice(clinicDb, action, context);
          break;

        case 'whatsapp_reminder':
          result = await this.executeWhatsAppReminder(clinicDb, action, context);
          break;

        default:
          throw new Error(`Unknown action type: ${action.action_type}`);
      }

      // Mark as completed
      await action.complete(result);

      logger.info(`Successfully executed action '${action.action_type}'`, {
        actionId,
        appointmentId: action.appointment_id
      });

      return {
        success: true,
        action,
        result
      };
    } catch (error) {
      // Mark as failed
      await action.fail(error);

      logger.error(`Failed to execute action '${action.action_type}'`, {
        actionId,
        appointmentId: action.appointment_id,
        error: error.message
      });

      return {
        success: false,
        action,
        error: error.message
      };
    }
  }

  /**
   * Execute confirmation email action
   */
  async executeConfirmationEmail(clinicDb, action, context) {
    const Appointment = await ModelFactory.getModel(clinicDb, 'Appointment');
    const Patient = await ModelFactory.getModel(clinicDb, 'Patient');

    const appointment = await Appointment.findByPk(action.appointment_id, {
      include: [
        { model: Patient, as: 'patient' }
      ]
    });

    if (!appointment || !appointment.patient) {
      throw new Error('Appointment or patient not found');
    }

    const patient = appointment.patient;

    // Generate confirmation token if not exists
    if (!appointment.confirmation_token) {
      await appointment.generateConfirmationToken(72); // 72 hours expiry
    }

    // Build confirmation URL
    const baseUrl = context.baseUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
    const confirmationUrl = `${baseUrl}/appointment/confirm/${appointment.confirmation_token}`;

    // Format date and time for patient's language
    const language = patient.preferred_language || 'es';
    const appointmentDate = this.formatDate(appointment.appointment_date, language);
    const appointmentTime = this.formatTime(appointment.start_time, language);

    // Get service name if available
    let serviceName = null;
    if (appointment.service_id) {
      const ProductService = await ModelFactory.getModel(clinicDb, 'ProductService');
      const service = await ProductService.findByPk(appointment.service_id);
      serviceName = service ? service.name : null;
    }

    // Send confirmation email
    const result = await messagingService.send('email', TEMPLATE_TYPES.APPOINTMENT_CONFIRMATION, {
      email: patient.email,
      language,
      patientName: `${patient.first_name} ${patient.last_name}`
    }, {
      clinicName: context.clinicName || 'MedicalPro',
      appointmentDate,
      appointmentTime,
      serviceName,
      confirmationUrl
    });

    return {
      messageId: result.messageId,
      confirmationToken: appointment.confirmation_token,
      sentTo: patient.email
    };
  }

  /**
   * Execute send consent action
   */
  async executeSendConsent(clinicDb, action, context) {
    const Appointment = await ModelFactory.getModel(clinicDb, 'Appointment');
    const Patient = await ModelFactory.getModel(clinicDb, 'Patient');
    const TreatmentConsentTemplate = await ModelFactory.getModel(clinicDb, 'TreatmentConsentTemplate');
    const ConsentTemplate = await ModelFactory.getModel(clinicDb, 'ConsentTemplate');
    const ConsentSigningRequest = await ModelFactory.getModel(clinicDb, 'ConsentSigningRequest');

    const appointment = await Appointment.findByPk(action.appointment_id, {
      include: [{ model: Patient, as: 'patient' }]
    });

    if (!appointment || !appointment.patient) {
      throw new Error('Appointment or patient not found');
    }

    const patient = appointment.patient;
    const language = patient.preferred_language || 'es';

    // Get treatments for this appointment (could be linked appointments)
    const treatmentIds = await this.getTreatmentIds(clinicDb, appointment);

    if (treatmentIds.length === 0) {
      // No treatments - mark as not required
      await appointment.updateConsentStatus('not_required');
      return {
        status: 'not_required',
        reason: 'No treatments associated with appointment'
      };
    }

    // Check consent coverage for treatments
    const coverage = await TreatmentConsentTemplate.checkCoverage(treatmentIds);

    if (!coverage.complete) {
      // Partial or no coverage - DO NOT send, alert user
      await appointment.updateConsentStatus('missing_association');

      return {
        status: 'missing_association',
        covered: coverage.covered,
        missing: coverage.missing,
        reason: 'Some treatments do not have consent templates associated'
      };
    }

    if (coverage.associations.length === 0) {
      // No consents associated at all
      await appointment.updateConsentStatus('not_required');
      return {
        status: 'not_required',
        reason: 'No consent templates associated with treatments'
      };
    }

    // Get unique consent template IDs
    const templateIds = [...new Set(coverage.associations.map(a => a.consent_template_id))];

    // Load consent templates
    const templates = await ConsentTemplate.findAll({
      where: { id: templateIds }
    });

    if (templates.length === 0) {
      throw new Error('No consent templates found');
    }

    const createdRequests = [];
    const baseUrl = context.baseUrl || process.env.FRONTEND_URL || 'http://localhost:3000';

    // Create consent signing requests for each template
    for (const template of templates) {
      // Create signing request in patient's language
      const signingRequest = await ConsentSigningRequest.create({
        company_id: template.company_id,
        patient_id: patient.id,
        consent_template_id: template.id,
        appointment_id: appointment.id,
        status: 'pending',
        language: language,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        metadata: {
          actionId: action.id,
          sentAutomatically: true
        }
      });

      createdRequests.push(signingRequest);

      // Send email notification
      const signingUrl = `${baseUrl}/consent/sign/${signingRequest.token}`;

      await messagingService.send('email', TEMPLATE_TYPES.CONSENT_REQUEST, {
        email: patient.email,
        language,
        patientName: `${patient.first_name} ${patient.last_name}`
      }, {
        clinicName: context.clinicName || 'MedicalPro',
        consentTitle: template.title,
        signingUrl,
        expiresAt: signingRequest.expires_at
      });
    }

    // Update action with related consent request
    if (createdRequests.length > 0) {
      action.related_consent_request_id = createdRequests[0].id;
      await action.save();
    }

    // Update appointment consent status
    await appointment.updateConsentStatus('sent');

    return {
      status: 'sent',
      consentCount: createdRequests.length,
      requestIds: createdRequests.map(r => r.id),
      sentTo: patient.email
    };
  }

  /**
   * Execute send quote action
   */
  async executeSendQuote(clinicDb, action, context) {
    const Appointment = await ModelFactory.getModel(clinicDb, 'Appointment');
    const Patient = await ModelFactory.getModel(clinicDb, 'Patient');
    const ProductService = await ModelFactory.getModel(clinicDb, 'ProductService');

    const appointment = await Appointment.findByPk(action.appointment_id, {
      include: [{ model: Patient, as: 'patient' }]
    });

    if (!appointment || !appointment.patient) {
      throw new Error('Appointment or patient not found');
    }

    const patient = appointment.patient;
    const language = patient.preferred_language || 'es';

    // Get treatments for this appointment
    const treatmentIds = await this.getTreatmentIds(clinicDb, appointment);

    if (treatmentIds.length === 0) {
      return {
        status: 'skipped',
        reason: 'No treatments to quote'
      };
    }

    // Load treatment details
    const treatments = await ProductService.findAll({
      where: { id: treatmentIds }
    });

    // Calculate total
    const items = treatments.map(t => ({
      productId: t.id,
      name: t.name,
      quantity: 1,
      unitPrice: t.sale_price || 0,
      total: t.sale_price || 0
    }));

    const totalAmount = items.reduce((sum, item) => sum + item.total, 0);

    // Generate quote number
    const quoteNumber = `Q-${appointment.appointment_number}`;

    // Store quote reference in action result (actual quote creation would be in a Quote service)
    // For now, we'll just notify about the quote

    // Send quote notification email
    const baseUrl = context.baseUrl || process.env.FRONTEND_URL || 'http://localhost:3000';

    await messagingService.send('email', TEMPLATE_TYPES.QUOTE_SENT, {
      email: patient.email,
      language,
      patientName: `${patient.first_name} ${patient.last_name}`
    }, {
      clinicName: context.clinicName || 'MedicalPro',
      quoteNumber,
      totalAmount: totalAmount.toFixed(2),
      viewUrl: null // Would be set if we had a quote viewing endpoint
    });

    return {
      status: 'sent',
      quoteNumber,
      totalAmount,
      itemCount: items.length,
      items,
      sentTo: patient.email
    };
  }

  /**
   * Execute prepare invoice action
   */
  async executePrepareInvoice(clinicDb, action, context) {
    const Appointment = await ModelFactory.getModel(clinicDb, 'Appointment');
    const Patient = await ModelFactory.getModel(clinicDb, 'Patient');
    const ProductService = await ModelFactory.getModel(clinicDb, 'ProductService');

    const appointment = await Appointment.findByPk(action.appointment_id, {
      include: [{ model: Patient, as: 'patient' }]
    });

    if (!appointment || !appointment.patient) {
      throw new Error('Appointment or patient not found');
    }

    // Get treatments for this appointment
    const treatmentIds = await this.getTreatmentIds(clinicDb, appointment);

    // Load treatment details for invoice items
    const treatments = treatmentIds.length > 0
      ? await ProductService.findAll({ where: { id: treatmentIds } })
      : [];

    // Calculate items and total
    const items = treatments.map(t => ({
      productId: t.id,
      name: t.name,
      quantity: 1,
      unitPrice: t.sale_price || 0,
      total: t.sale_price || 0
    }));

    const totalAmount = items.reduce((sum, item) => sum + item.total, 0);

    // Generate invoice number
    const invoiceNumber = `INV-${appointment.appointment_number}`;

    // Note: Actual invoice creation would go through an Invoice service
    // This just prepares the data and notifies that a draft is ready

    return {
      status: 'prepared',
      invoiceNumber,
      totalAmount,
      itemCount: items.length,
      items,
      patientId: appointment.patient_id,
      appointmentId: appointment.id,
      needsValidation: true,
      message: 'Invoice draft prepared, awaiting validation'
    };
  }

  /**
   * Execute WhatsApp reminder action
   */
  async executeWhatsAppReminder(clinicDb, action, context) {
    const Appointment = await ModelFactory.getModel(clinicDb, 'Appointment');
    const Patient = await ModelFactory.getModel(clinicDb, 'Patient');

    const appointment = await Appointment.findByPk(action.appointment_id, {
      include: [{ model: Patient, as: 'patient' }]
    });

    if (!appointment || !appointment.patient) {
      throw new Error('Appointment or patient not found');
    }

    const patient = appointment.patient;

    if (!patient.phone) {
      throw new Error('Patient has no phone number');
    }

    // Check if WhatsApp is available
    if (!messagingService.isChannelAvailable('whatsapp')) {
      throw new Error('WhatsApp channel is not configured');
    }

    const language = patient.preferred_language || 'es';
    const appointmentDate = this.formatDate(appointment.appointment_date, language);
    const appointmentTime = this.formatTime(appointment.start_time, language);

    const result = await messagingService.send('whatsapp', TEMPLATE_TYPES.APPOINTMENT_REMINDER, {
      phone: patient.phone,
      language,
      patientName: `${patient.first_name} ${patient.last_name}`
    }, {
      clinicName: context.clinicName || 'MedicalPro',
      appointmentDate,
      appointmentTime
    });

    return {
      sentTo: patient.phone,
      ...result
    };
  }

  /**
   * Get treatment IDs for an appointment (including linked appointments)
   */
  async getTreatmentIds(clinicDb, appointment) {
    const Appointment = await ModelFactory.getModel(clinicDb, 'Appointment');
    const treatmentIds = [];

    // Get this appointment's service
    if (appointment.service_id) {
      treatmentIds.push(appointment.service_id);
    }

    // Check for linked appointments (multi-treatment sessions)
    const linkedGroup = await Appointment.findLinkedGroup(appointment.id);

    for (const linkedApt of linkedGroup) {
      if (linkedApt.service_id && !treatmentIds.includes(linkedApt.service_id)) {
        treatmentIds.push(linkedApt.service_id);
      }
    }

    return treatmentIds;
  }

  /**
   * Format date for display
   */
  formatDate(dateStr, language = 'es') {
    const date = new Date(dateStr);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const locales = {
      fr: 'fr-FR',
      en: 'en-US',
      es: 'es-ES'
    };
    return date.toLocaleDateString(locales[language] || locales.es, options);
  }

  /**
   * Format time for display
   */
  formatTime(timeStr, language = 'es') {
    // timeStr is in format HH:MM:SS
    const [hours, minutes] = timeStr.split(':');
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes));

    const options = { hour: '2-digit', minute: '2-digit' };
    const locales = {
      fr: 'fr-FR',
      en: 'en-US',
      es: 'es-ES'
    };
    return date.toLocaleTimeString(locales[language] || locales.es, options);
  }

  /**
   * Retry a failed action
   */
  async retryAction(clinicDb, actionId, context = {}) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');

    const action = await AppointmentAction.findByPk(actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    if (!action.canRetry()) {
      throw new Error(`Action cannot be retried (status: ${action.status}, retries: ${action.retry_count}/${action.max_retries})`);
    }

    // Reset status for retry
    action.status = action.requires_validation && !action.validated_at ? 'pending' : 'scheduled';
    await action.save();

    // Execute the action
    return await this.executeAction(clinicDb, actionId, context);
  }

  /**
   * Execute all ready actions
   * Called by the job scheduler
   */
  async executeReadyActions(clinicDb, context = {}) {
    const AppointmentAction = await ModelFactory.getModel(clinicDb, 'AppointmentAction');

    const readyActions = await AppointmentAction.findReadyForExecution();
    const results = [];

    for (const action of readyActions) {
      const result = await this.executeAction(clinicDb, action.id, context);
      results.push(result);
    }

    return {
      executed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }
}

// Export singleton
module.exports = new AppointmentActionExecutorService();

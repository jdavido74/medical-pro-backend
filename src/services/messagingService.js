/**
 * Messaging Service
 * Unified messaging interface supporting multiple channels:
 * - Email (implemented via emailService)
 * - WhatsApp (interface ready, Twilio implementation pending)
 * - SMS (interface ready, Twilio implementation pending)
 *
 * Usage:
 * const messagingService = require('./messagingService');
 *
 * // Send via email
 * await messagingService.send('email', 'appointment_confirmation', recipient, data);
 *
 * // Send via multiple channels
 * await messagingService.sendMultiChannel(['email', 'whatsapp'], 'reminder', recipient, data);
 */

const emailService = require('./emailService');
const { logger } = require('../utils/logger');

/**
 * Message template types
 */
const TEMPLATE_TYPES = {
  APPOINTMENT_CONFIRMATION: 'appointment_confirmation',
  APPOINTMENT_REMINDER: 'appointment_reminder',
  CONSENT_REQUEST: 'consent_request',
  QUOTE_SENT: 'quote_sent',
  INVOICE_READY: 'invoice_ready'
};

/**
 * Channel types
 */
const CHANNEL_TYPES = {
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  SMS: 'sms'
};

/**
 * Abstract base class for message channels
 */
class MessageChannel {
  constructor(name) {
    this.name = name;
  }

  /**
   * Send a message via this channel
   * @param {string} templateType - Type of message template
   * @param {object} recipient - { email, phone, language, name, patientName }
   * @param {object} data - Template data
   * @returns {Promise<object>} Result with success status
   */
  async send(templateType, recipient, data) {
    throw new Error('Method send() must be implemented by subclass');
  }

  /**
   * Check if channel is available/configured
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }

  /**
   * Get channel name
   * @returns {string}
   */
  getName() {
    return this.name;
  }
}

/**
 * Email Channel - Uses existing emailService
 */
class EmailChannel extends MessageChannel {
  constructor() {
    super('email');
  }

  isAvailable() {
    return true; // Email is always available
  }

  async send(templateType, recipient, data) {
    const { email, language = 'fr', patientName, name } = recipient;

    if (!email) {
      throw new Error('Email address is required for email channel');
    }

    const recipientName = patientName || name || 'Patient';

    switch (templateType) {
      case TEMPLATE_TYPES.APPOINTMENT_CONFIRMATION:
        return await this._sendAppointmentConfirmation(email, recipientName, data, language);

      case TEMPLATE_TYPES.APPOINTMENT_REMINDER:
        return await this._sendAppointmentReminder(email, recipientName, data, language);

      case TEMPLATE_TYPES.CONSENT_REQUEST:
        return await emailService.sendConsentSigningRequest({
          email,
          patientName: recipientName,
          clinicName: data.clinicName,
          consentTitle: data.consentTitle,
          signingUrl: data.signingUrl,
          expiresAt: data.expiresAt,
          customMessage: data.customMessage,
          language
        });

      case TEMPLATE_TYPES.QUOTE_SENT:
        return await this._sendQuoteSent(email, recipientName, data, language);

      case TEMPLATE_TYPES.INVOICE_READY:
        return await this._sendInvoiceReady(email, recipientName, data, language);

      default:
        throw new Error(`Unknown template type: ${templateType}`);
    }
  }

  /**
   * Send appointment confirmation request email
   */
  async _sendAppointmentConfirmation(email, patientName, data, language) {
    const templates = {
      fr: this._getAppointmentConfirmationTemplateFR,
      en: this._getAppointmentConfirmationTemplateEN,
      es: this._getAppointmentConfirmationTemplateES
    };

    const templateFn = templates[language] || templates.fr;
    const htmlContent = templateFn.call(this, { email, patientName, ...data });

    const subjects = {
      fr: `Confirmez votre rendez-vous - ${data.clinicName}`,
      en: `Confirm your appointment - ${data.clinicName}`,
      es: `Confirme su cita - ${data.clinicName}`
    };

    return await this._sendEmail(email, subjects[language] || subjects.fr, htmlContent, 'CONFIRMATION');
  }

  /**
   * Send appointment reminder email
   */
  async _sendAppointmentReminder(email, patientName, data, language) {
    const templates = {
      fr: this._getAppointmentReminderTemplateFR,
      en: this._getAppointmentReminderTemplateEN,
      es: this._getAppointmentReminderTemplateES
    };

    const templateFn = templates[language] || templates.fr;
    const htmlContent = templateFn.call(this, { email, patientName, ...data });

    const subjects = {
      fr: `Rappel: Rendez-vous demain - ${data.clinicName}`,
      en: `Reminder: Appointment tomorrow - ${data.clinicName}`,
      es: `Recordatorio: Cita mañana - ${data.clinicName}`
    };

    return await this._sendEmail(email, subjects[language] || subjects.fr, htmlContent, 'REMINDER');
  }

  /**
   * Send quote notification email
   */
  async _sendQuoteSent(email, patientName, data, language) {
    const templates = {
      fr: this._getQuoteSentTemplateFR,
      en: this._getQuoteSentTemplateEN,
      es: this._getQuoteSentTemplateES
    };

    const templateFn = templates[language] || templates.fr;
    const htmlContent = templateFn.call(this, { email, patientName, ...data });

    const subjects = {
      fr: `Votre devis - ${data.clinicName}`,
      en: `Your quote - ${data.clinicName}`,
      es: `Su presupuesto - ${data.clinicName}`
    };

    return await this._sendEmail(email, subjects[language] || subjects.fr, htmlContent, 'QUOTE');
  }

  /**
   * Send invoice ready notification
   */
  async _sendInvoiceReady(email, patientName, data, language) {
    const templates = {
      fr: this._getInvoiceReadyTemplateFR,
      en: this._getInvoiceReadyTemplateEN,
      es: this._getInvoiceReadyTemplateES
    };

    const templateFn = templates[language] || templates.fr;
    const htmlContent = templateFn.call(this, { email, patientName, ...data });

    const subjects = {
      fr: `Votre facture - ${data.clinicName}`,
      en: `Your invoice - ${data.clinicName}`,
      es: `Su factura - ${data.clinicName}`
    };

    return await this._sendEmail(email, subjects[language] || subjects.fr, htmlContent, 'INVOICE');
  }

  /**
   * Internal method to send email via nodemailer
   */
  async _sendEmail(to, subject, html, emailType) {
    try {
      const recipientEmail = emailService.getRecipientEmail(to);
      let htmlContent = html;

      if (emailService.testModeEnabled) {
        htmlContent = emailService.wrapEmailContentWithTestInfo(htmlContent, to);
      }

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: emailService.getEmailSubject(subject, emailType),
        html: htmlContent
      };

      const result = await emailService.transporter.sendMail(mailOptions);

      logger.info(`✅ ${emailType} email sent to ${to}`, {
        provider: emailService.provider,
        testMode: emailService.testModeEnabled
      });

      return {
        success: true,
        channel: 'email',
        provider: emailService.provider,
        messageId: result.messageId,
        testMode: emailService.testModeEnabled,
        actualRecipient: emailService.testModeEnabled ? recipientEmail : to
      };
    } catch (error) {
      logger.error(`❌ Failed to send ${emailType} email to ${to}:`, error);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  // ========== EMAIL TEMPLATES ==========

  _getAppointmentConfirmationTemplateFR({ email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, confirmationUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .appointment-box { background-color: #f0f4ff; border: 1px solid #667eea; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .button { display: inline-block; background-color: #667eea; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">📅 Confirmez votre rendez-vous</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Bonjour ${patientName},</h2>
              <p>Vous avez un rendez-vous prévu chez <strong>${clinicName}</strong>.</p>
              <div class="appointment-box">
                <p style="margin: 5px 0;"><strong>📆 Date :</strong> ${appointmentDate}</p>
                <p style="margin: 5px 0;"><strong>🕐 Heure :</strong> ${appointmentTime}</p>
                ${serviceName ? `<p style="margin: 5px 0;"><strong>💉 Traitement :</strong> ${serviceName}</p>` : ''}
              </div>
              <p>Merci de confirmer votre présence en cliquant sur le bouton ci-dessous :</p>
              <center>
                <a href="${confirmationUrl}" class="button">Confirmer ma présence</a>
              </center>
              <p style="color: #666; font-size: 14px;">
                Si vous ne pouvez pas venir, merci de nous contacter pour reporter votre rendez-vous.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Propulsé par MedicalPro</p>
              <p>Cet email a été envoyé à ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getAppointmentConfirmationTemplateEN({ email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, confirmationUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .appointment-box { background-color: #f0f4ff; border: 1px solid #667eea; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .button { display: inline-block; background-color: #667eea; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">📅 Confirm Your Appointment</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Hello ${patientName},</h2>
              <p>You have an appointment scheduled at <strong>${clinicName}</strong>.</p>
              <div class="appointment-box">
                <p style="margin: 5px 0;"><strong>📆 Date:</strong> ${appointmentDate}</p>
                <p style="margin: 5px 0;"><strong>🕐 Time:</strong> ${appointmentTime}</p>
                ${serviceName ? `<p style="margin: 5px 0;"><strong>💉 Treatment:</strong> ${serviceName}</p>` : ''}
              </div>
              <p>Please confirm your attendance by clicking the button below:</p>
              <center>
                <a href="${confirmationUrl}" class="button">Confirm My Attendance</a>
              </center>
              <p style="color: #666; font-size: 14px;">
                If you cannot attend, please contact us to reschedule your appointment.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Powered by MedicalPro</p>
              <p>This email was sent to ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getAppointmentConfirmationTemplateES({ email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, confirmationUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .appointment-box { background-color: #f0f4ff; border: 1px solid #667eea; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .button { display: inline-block; background-color: #667eea; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">📅 Confirme su Cita</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Hola ${patientName},</h2>
              <p>Tiene una cita programada en <strong>${clinicName}</strong>.</p>
              <div class="appointment-box">
                <p style="margin: 5px 0;"><strong>📆 Fecha:</strong> ${appointmentDate}</p>
                <p style="margin: 5px 0;"><strong>🕐 Hora:</strong> ${appointmentTime}</p>
                ${serviceName ? `<p style="margin: 5px 0;"><strong>💉 Tratamiento:</strong> ${serviceName}</p>` : ''}
              </div>
              <p>Por favor confirme su asistencia haciendo clic en el botón de abajo:</p>
              <center>
                <a href="${confirmationUrl}" class="button">Confirmar Mi Asistencia</a>
              </center>
              <p style="color: #666; font-size: 14px;">
                Si no puede asistir, contáctenos para reprogramar su cita.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Impulsado por MedicalPro</p>
              <p>Este correo fue enviado a ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getAppointmentReminderTemplateFR({ email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, address }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .appointment-box { background-color: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⏰ Rappel de rendez-vous</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Bonjour ${patientName},</h2>
              <p>Nous vous rappelons votre rendez-vous <strong>demain</strong> chez ${clinicName}.</p>
              <div class="appointment-box">
                <p style="margin: 5px 0;"><strong>📆 Date :</strong> ${appointmentDate}</p>
                <p style="margin: 5px 0;"><strong>🕐 Heure :</strong> ${appointmentTime}</p>
                ${serviceName ? `<p style="margin: 5px 0;"><strong>💉 Traitement :</strong> ${serviceName}</p>` : ''}
                ${address ? `<p style="margin: 5px 0;"><strong>📍 Adresse :</strong> ${address}</p>` : ''}
              </div>
              <p>N'oubliez pas d'apporter vos documents d'identité et votre carte de santé.</p>
              <p style="color: #666; font-size: 14px;">
                En cas d'empêchement, merci de nous prévenir au plus vite.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Propulsé par MedicalPro</p>
              <p>Cet email a été envoyé à ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getAppointmentReminderTemplateEN({ email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, address }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .appointment-box { background-color: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⏰ Appointment Reminder</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Hello ${patientName},</h2>
              <p>This is a reminder of your appointment <strong>tomorrow</strong> at ${clinicName}.</p>
              <div class="appointment-box">
                <p style="margin: 5px 0;"><strong>📆 Date:</strong> ${appointmentDate}</p>
                <p style="margin: 5px 0;"><strong>🕐 Time:</strong> ${appointmentTime}</p>
                ${serviceName ? `<p style="margin: 5px 0;"><strong>💉 Treatment:</strong> ${serviceName}</p>` : ''}
                ${address ? `<p style="margin: 5px 0;"><strong>📍 Address:</strong> ${address}</p>` : ''}
              </div>
              <p>Don't forget to bring your ID and health card.</p>
              <p style="color: #666; font-size: 14px;">
                If you cannot make it, please let us know as soon as possible.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Powered by MedicalPro</p>
              <p>This email was sent to ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getAppointmentReminderTemplateES({ email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, address }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .appointment-box { background-color: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⏰ Recordatorio de Cita</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Hola ${patientName},</h2>
              <p>Le recordamos su cita <strong>mañana</strong> en ${clinicName}.</p>
              <div class="appointment-box">
                <p style="margin: 5px 0;"><strong>📆 Fecha:</strong> ${appointmentDate}</p>
                <p style="margin: 5px 0;"><strong>🕐 Hora:</strong> ${appointmentTime}</p>
                ${serviceName ? `<p style="margin: 5px 0;"><strong>💉 Tratamiento:</strong> ${serviceName}</p>` : ''}
                ${address ? `<p style="margin: 5px 0;"><strong>📍 Dirección:</strong> ${address}</p>` : ''}
              </div>
              <p>No olvide traer su documento de identidad y tarjeta sanitaria.</p>
              <p style="color: #666; font-size: 14px;">
                Si no puede asistir, avísenos lo antes posible.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Impulsado por MedicalPro</p>
              <p>Este correo fue enviado a ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getQuoteSentTemplateFR({ email, patientName, clinicName, quoteNumber, totalAmount, viewUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .quote-box { background-color: #f0fdf4; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .button { display: inline-block; background-color: #10b981; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">📄 Votre devis</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Bonjour ${patientName},</h2>
              <p>Veuillez trouver ci-joint votre devis pour les soins prévus.</p>
              <div class="quote-box">
                <p style="margin: 5px 0;"><strong>Numéro :</strong> ${quoteNumber}</p>
                <p style="margin: 5px 0;"><strong>Montant total :</strong> ${totalAmount} €</p>
              </div>
              ${viewUrl ? `
              <center>
                <a href="${viewUrl}" class="button">Voir le devis</a>
              </center>
              ` : ''}
              <p style="color: #666; font-size: 14px;">
                Ce devis est valable 30 jours. Pour toute question, n'hésitez pas à nous contacter.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Propulsé par MedicalPro</p>
              <p>Cet email a été envoyé à ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getQuoteSentTemplateEN({ email, patientName, clinicName, quoteNumber, totalAmount, viewUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .quote-box { background-color: #f0fdf4; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .button { display: inline-block; background-color: #10b981; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">📄 Your Quote</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Hello ${patientName},</h2>
              <p>Please find enclosed your quote for the planned treatments.</p>
              <div class="quote-box">
                <p style="margin: 5px 0;"><strong>Number:</strong> ${quoteNumber}</p>
                <p style="margin: 5px 0;"><strong>Total Amount:</strong> €${totalAmount}</p>
              </div>
              ${viewUrl ? `
              <center>
                <a href="${viewUrl}" class="button">View Quote</a>
              </center>
              ` : ''}
              <p style="color: #666; font-size: 14px;">
                This quote is valid for 30 days. For any questions, please contact us.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Powered by MedicalPro</p>
              <p>This email was sent to ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getQuoteSentTemplateES({ email, patientName, clinicName, quoteNumber, totalAmount, viewUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .quote-box { background-color: #f0fdf4; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .button { display: inline-block; background-color: #10b981; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">📄 Su Presupuesto</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Hola ${patientName},</h2>
              <p>Por favor encuentre adjunto su presupuesto para los tratamientos previstos.</p>
              <div class="quote-box">
                <p style="margin: 5px 0;"><strong>Número:</strong> ${quoteNumber}</p>
                <p style="margin: 5px 0;"><strong>Importe Total:</strong> ${totalAmount} €</p>
              </div>
              ${viewUrl ? `
              <center>
                <a href="${viewUrl}" class="button">Ver Presupuesto</a>
              </center>
              ` : ''}
              <p style="color: #666; font-size: 14px;">
                Este presupuesto es válido por 30 días. Para cualquier pregunta, contáctenos.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Impulsado por MedicalPro</p>
              <p>Este correo fue enviado a ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getInvoiceReadyTemplateFR({ email, patientName, clinicName, invoiceNumber, totalAmount, viewUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .invoice-box { background-color: #f0f7ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .button { display: inline-block; background-color: #3b82f6; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">🧾 Votre facture</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Bonjour ${patientName},</h2>
              <p>Votre facture pour les soins reçus est disponible.</p>
              <div class="invoice-box">
                <p style="margin: 5px 0;"><strong>Numéro :</strong> ${invoiceNumber}</p>
                <p style="margin: 5px 0;"><strong>Montant :</strong> ${totalAmount} €</p>
              </div>
              ${viewUrl ? `
              <center>
                <a href="${viewUrl}" class="button">Voir la facture</a>
              </center>
              ` : ''}
              <p style="color: #666; font-size: 14px;">
                Pour toute question concernant cette facture, n'hésitez pas à nous contacter.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Propulsé par MedicalPro</p>
              <p>Cet email a été envoyé à ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getInvoiceReadyTemplateEN({ email, patientName, clinicName, invoiceNumber, totalAmount, viewUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .invoice-box { background-color: #f0f7ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .button { display: inline-block; background-color: #3b82f6; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">🧾 Your Invoice</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Hello ${patientName},</h2>
              <p>Your invoice for the services received is now available.</p>
              <div class="invoice-box">
                <p style="margin: 5px 0;"><strong>Number:</strong> ${invoiceNumber}</p>
                <p style="margin: 5px 0;"><strong>Amount:</strong> €${totalAmount}</p>
              </div>
              ${viewUrl ? `
              <center>
                <a href="${viewUrl}" class="button">View Invoice</a>
              </center>
              ` : ''}
              <p style="color: #666; font-size: 14px;">
                For any questions regarding this invoice, please contact us.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Powered by MedicalPro</p>
              <p>This email was sent to ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  _getInvoiceReadyTemplateES({ email, patientName, clinicName, invoiceNumber, totalAmount, viewUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .invoice-box { background-color: #f0f7ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .button { display: inline-block; background-color: #3b82f6; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">🧾 Su Factura</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${clinicName}</p>
            </div>
            <div class="content">
              <h2>Hola ${patientName},</h2>
              <p>Su factura por los servicios recibidos está disponible.</p>
              <div class="invoice-box">
                <p style="margin: 5px 0;"><strong>Número:</strong> ${invoiceNumber}</p>
                <p style="margin: 5px 0;"><strong>Importe:</strong> ${totalAmount} €</p>
              </div>
              ${viewUrl ? `
              <center>
                <a href="${viewUrl}" class="button">Ver Factura</a>
              </center>
              ` : ''}
              <p style="color: #666; font-size: 14px;">
                Para cualquier pregunta sobre esta factura, contáctenos.
              </p>
            </div>
            <div class="footer">
              <p>© 2025 ${clinicName} - Impulsado por MedicalPro</p>
              <p>Este correo fue enviado a ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}

/**
 * WhatsApp Channel - Interface ready, Twilio implementation pending
 */
class WhatsAppChannel extends MessageChannel {
  constructor() {
    super('whatsapp');
    this.provider = null; // Twilio to be implemented
  }

  isAvailable() {
    return process.env.TWILIO_WHATSAPP_ENABLED === 'true';
  }

  async send(templateType, recipient, data) {
    if (!this.isAvailable()) {
      throw new Error('WhatsApp channel not configured. Set TWILIO_WHATSAPP_ENABLED=true and configure Twilio credentials.');
    }

    const { phone, language = 'es' } = recipient;

    if (!phone) {
      throw new Error('Phone number is required for WhatsApp channel');
    }

    // TODO: Implement Twilio WhatsApp Business API
    // This will require:
    // - TWILIO_ACCOUNT_SID
    // - TWILIO_AUTH_TOKEN
    // - TWILIO_WHATSAPP_FROM (WhatsApp Business number)
    // - Pre-approved message templates

    logger.warn('WhatsApp channel not yet implemented. Message would be sent to:', phone);

    return {
      success: false,
      channel: 'whatsapp',
      error: 'WhatsApp channel not yet implemented',
      phone
    };
  }
}

/**
 * SMS Channel - Interface ready, Twilio implementation pending
 */
class SMSChannel extends MessageChannel {
  constructor() {
    super('sms');
    this.provider = null; // Twilio to be implemented
  }

  isAvailable() {
    return process.env.TWILIO_SMS_ENABLED === 'true';
  }

  async send(templateType, recipient, data) {
    if (!this.isAvailable()) {
      throw new Error('SMS channel not configured. Set TWILIO_SMS_ENABLED=true and configure Twilio credentials.');
    }

    const { phone, language = 'es' } = recipient;

    if (!phone) {
      throw new Error('Phone number is required for SMS channel');
    }

    // TODO: Implement Twilio SMS API
    // This will require:
    // - TWILIO_ACCOUNT_SID
    // - TWILIO_AUTH_TOKEN
    // - TWILIO_SMS_FROM (SMS phone number)

    logger.warn('SMS channel not yet implemented. Message would be sent to:', phone);

    return {
      success: false,
      channel: 'sms',
      error: 'SMS channel not yet implemented',
      phone
    };
  }
}

/**
 * Main Messaging Service
 */
class MessagingService {
  constructor() {
    this.channels = {
      [CHANNEL_TYPES.EMAIL]: new EmailChannel(),
      [CHANNEL_TYPES.WHATSAPP]: new WhatsAppChannel(),
      [CHANNEL_TYPES.SMS]: new SMSChannel()
    };
  }

  /**
   * Send a message via a specific channel
   * @param {string} channel - Channel type ('email', 'whatsapp', 'sms')
   * @param {string} templateType - Message template type
   * @param {object} recipient - Recipient info (email, phone, language, name)
   * @param {object} data - Template data
   * @returns {Promise<object>} Send result
   */
  async send(channel, templateType, recipient, data) {
    const channelInstance = this.channels[channel];

    if (!channelInstance) {
      throw new Error(`Unknown channel: ${channel}`);
    }

    if (!channelInstance.isAvailable()) {
      throw new Error(`Channel ${channel} is not available/configured`);
    }

    return await channelInstance.send(templateType, recipient, data);
  }

  /**
   * Send a message via multiple channels
   * @param {string[]} channels - Array of channel types
   * @param {string} templateType - Message template type
   * @param {object} recipient - Recipient info
   * @param {object} data - Template data
   * @returns {Promise<object[]>} Array of send results
   */
  async sendMultiChannel(channels, templateType, recipient, data) {
    const results = [];

    for (const channel of channels) {
      try {
        const result = await this.send(channel, templateType, recipient, data);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          channel,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Check if a channel is available
   * @param {string} channel - Channel type
   * @returns {boolean}
   */
  isChannelAvailable(channel) {
    const channelInstance = this.channels[channel];
    return channelInstance ? channelInstance.isAvailable() : false;
  }

  /**
   * Get list of available channels
   * @returns {string[]}
   */
  getAvailableChannels() {
    return Object.entries(this.channels)
      .filter(([_, channel]) => channel.isAvailable())
      .map(([name, _]) => name);
  }
}

// Export singleton instance and constants
const messagingService = new MessagingService();

module.exports = messagingService;
module.exports.MessagingService = MessagingService;
module.exports.TEMPLATE_TYPES = TEMPLATE_TYPES;
module.exports.CHANNEL_TYPES = CHANNEL_TYPES;

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
 * Email Channel - Delegates all templates to emailService
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
        return await emailService.sendAppointmentConfirmation({
          email,
          patientName: recipientName,
          clinicName: data.clinicName,
          appointmentDate: data.appointmentDate,
          appointmentTime: data.appointmentTime,
          serviceName: data.serviceName,
          confirmationUrl: data.confirmationUrl,
          language,
          logoUrl: data.logoUrl || null
        });

      case TEMPLATE_TYPES.APPOINTMENT_REMINDER:
        return await emailService.sendAppointmentReminder({
          email,
          patientName: recipientName,
          clinicName: data.clinicName,
          appointmentDate: data.appointmentDate,
          appointmentTime: data.appointmentTime,
          serviceName: data.serviceName,
          address: data.address,
          language,
          logoUrl: data.logoUrl || null
        });

      case TEMPLATE_TYPES.CONSENT_REQUEST:
        return await emailService.sendConsentSigningRequest({
          email,
          patientName: recipientName,
          clinicName: data.clinicName,
          consentTitle: data.consentTitle,
          signingUrl: data.signingUrl,
          expiresAt: data.expiresAt,
          customMessage: data.customMessage,
          language,
          logoUrl: data.logoUrl || null
        });

      case TEMPLATE_TYPES.QUOTE_SENT:
        return await emailService.sendQuoteSent({
          email,
          patientName: recipientName,
          clinicName: data.clinicName,
          quoteNumber: data.quoteNumber,
          totalAmount: data.totalAmount,
          viewUrl: data.viewUrl,
          language,
          logoUrl: data.logoUrl || null
        });

      case TEMPLATE_TYPES.INVOICE_READY:
        return await emailService.sendInvoiceReady({
          email,
          patientName: recipientName,
          clinicName: data.clinicName,
          invoiceNumber: data.invoiceNumber,
          totalAmount: data.totalAmount,
          viewUrl: data.viewUrl,
          language,
          logoUrl: data.logoUrl || null
        });

      default:
        throw new Error(`Unknown template type: ${templateType}`);
    }
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

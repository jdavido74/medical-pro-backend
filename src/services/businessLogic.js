const { Appointment, AppointmentItem, Document, Consent, ConsentTemplate, ProductService } = require('../models');
const { logger } = require('../utils/logger');

/**
 * Generate a draft quote from appointment items
 * @param {UUID} appointmentId - Appointment ID
 * @param {UUID} companyId - Company ID for multi-tenancy
 * @returns {Object} Created Document (quote)
 */
async function generateQuoteFromAppointment(appointmentId, companyId) {
  try {
    // Get appointment with patient, practitioner, and items
    const appointment = await Appointment.findOne({
      where: { id: appointmentId, company_id: companyId, deleted_at: null },
      include: [
        { association: 'patient', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'practitioner', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'items', where: { deleted_at: null }, required: false }
      ]
    });

    if (!appointment) {
      throw new Error('Appointment not found');
    }

    if (!appointment.items || appointment.items.length === 0) {
      throw new Error('Appointment has no items. Cannot generate quote.');
    }

    // Calculate totals from items
    let subtotal = 0;
    const items = appointment.items.map(item => {
      const itemTotal = item.quantity * parseFloat(item.unit_price);
      subtotal += itemTotal;
      return {
        product_service_id: item.product_service_id,
        description: item.notes || 'Service',
        quantity: item.quantity,
        unit_price: parseFloat(item.unit_price),
        total: itemTotal
      };
    });

    // Simple tax calculation (default 20% - should be configurable)
    const taxRate = 0.20;
    const tax_amount = subtotal * taxRate;
    const total = subtotal + tax_amount;

    // Generate document number
    const count = await Document.count({
      where: { company_id: companyId, document_type: 'quote', deleted_at: null }
    });
    const year = new Date().getFullYear();
    const document_number = `DV-${year}-${String(count + 1).padStart(4, '0')}`;

    // Create draft quote
    const quote = await Document.create({
      company_id: companyId,
      patient_id: appointment.patient_id,
      appointment_id: appointmentId,
      practitioner_id: appointment.practitioner_id,
      document_type: 'quote',
      document_number,
      issue_date: new Date(),
      items,
      subtotal: subtotal.toFixed(2),
      tax_amount: tax_amount.toFixed(2),
      total: total.toFixed(2),
      status: 'draft'
    });

    logger.info('Draft quote generated from appointment', {
      quoteId: quote.id,
      appointmentId: appointment.id,
      patientId: appointment.patient_id,
      documentNumber: document_number,
      total: total.toFixed(2)
    });

    return quote;
  } catch (error) {
    logger.error('Failed to generate quote from appointment', {
      appointmentId,
      companyId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get consents that should be auto-sent when document is sent
 * @param {UUID} appointmentId - Appointment ID
 * @param {UUID} companyId - Company ID
 * @returns {Array} Array of ConsentTemplate objects with auto_send = true
 */
async function getAutoSendConsents(appointmentId, companyId) {
  try {
    // Get all mandatory, auto-send consent templates for this company
    // Valid between valid_from and valid_until
    const now = new Date();

    const templates = await ConsentTemplate.findAll({
      where: {
        company_id: companyId,
        is_mandatory: true,
        auto_send: true,
        valid_from: { [require('sequelize').Op.lte]: now },
        [require('sequelize').Op.or]: [
          { valid_until: null },
          { valid_until: { [require('sequelize').Op.gte]: now } }
        ],
        deleted_at: null
      }
    });

    return templates;
  } catch (error) {
    logger.error('Failed to get auto-send consents', {
      appointmentId,
      companyId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Create consents from templates when document is sent
 * @param {UUID} appointmentId - Appointment ID
 * @param {UUID} patientId - Patient ID
 * @param {UUID} documentId - Document ID (the quote/invoice being sent)
 * @param {Array} templateIds - Array of ConsentTemplate IDs to create from
 * @param {UUID} companyId - Company ID
 * @returns {Array} Array of created Consent records
 */
async function createConsentsFromTemplates(appointmentId, patientId, documentId, templateIds, companyId) {
  try {
    if (!templateIds || templateIds.length === 0) {
      return [];
    }

    // Get templates
    const templates = await ConsentTemplate.findAll({
      where: {
        id: templateIds,
        company_id: companyId,
        deleted_at: null
      }
    });

    if (templates.length === 0) {
      return [];
    }

    // Create consent for each template
    const consents = await Promise.all(
      templates.map(template =>
        Consent.create({
          company_id: companyId,
          patient_id: patientId,
          appointment_id: appointmentId,
          consent_template_id: template.id,
          consent_type: template.consent_type,
          title: template.title,
          description: template.description,
          terms: template.terms,
          status: 'pending',
          related_document_id: documentId
        })
      )
    );

    logger.info('Consents created from templates', {
      appointmentId,
      patientId,
      documentId,
      consentCount: consents.length,
      templateIds
    });

    return consents;
  } catch (error) {
    logger.error('Failed to create consents from templates', {
      appointmentId,
      patientId,
      documentId,
      templateIds,
      companyId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Calculate appointment cost based on items
 * @param {UUID} appointmentId - Appointment ID
 * @param {UUID} companyId - Company ID
 * @returns {Object} { subtotal, tax_amount, total }
 */
async function calculateAppointmentCost(appointmentId, companyId) {
  try {
    const items = await AppointmentItem.findAll({
      where: {
        appointment_id: appointmentId,
        company_id: companyId,
        deleted_at: null
      }
    });

    let subtotal = 0;
    items.forEach(item => {
      subtotal += item.quantity * parseFloat(item.unit_price);
    });

    const taxRate = 0.20; // Default 20% - should be configurable per company
    const tax_amount = subtotal * taxRate;
    const total = subtotal + tax_amount;

    return {
      subtotal: parseFloat(subtotal.toFixed(2)),
      tax_amount: parseFloat(tax_amount.toFixed(2)),
      total: parseFloat(total.toFixed(2))
    };
  } catch (error) {
    logger.error('Failed to calculate appointment cost', {
      appointmentId,
      companyId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  generateQuoteFromAppointment,
  getAutoSendConsents,
  createConsentsFromTemplates,
  calculateAppointmentCost
};

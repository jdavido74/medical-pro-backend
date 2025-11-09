/**
 * Documents Routes - Clinic Isolated
 * CRUD operations for documents (quotes/invoices) with clinic-specific database isolation
 *
 * Discriminator: document_type = 'quote' | 'invoice'
 * Single table with automatic number generation
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const { getModel } = require('../base/ModelFactory');
const { logger } = require('../utils/logger');

const router = express.Router();

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(255).optional(),
  documentType: Joi.string().valid('quote', 'invoice').optional(),
  status: Joi.string().valid('draft', 'sent', 'accepted', 'rejected', 'paid', 'cancelled').optional(),
  patientId: Joi.string().uuid().optional()
});

const documentRoutes = clinicCrudRoutes('Document', {
  createSchema: Joi.object({
    patientId: Joi.string().uuid().required(),
    appointmentId: Joi.string().uuid().optional(),
    practitionerId: Joi.string().uuid().optional(),
    documentType: Joi.string().valid('quote', 'invoice').required(),
    issueDate: Joi.date().iso().required(),
    dueDate: Joi.date().iso().optional(),
    items: Joi.array().items(Joi.object()).optional(),
    subtotal: Joi.number().precision(2).required(),
    taxAmount: Joi.number().precision(2).required(),
    total: Joi.number().precision(2).required()
  }),
  updateSchema: Joi.object({
    status: Joi.string().valid('draft', 'sent', 'accepted', 'rejected', 'paid', 'cancelled').optional(),
    items: Joi.array().items(Joi.object()).optional(),
    subtotal: Joi.number().precision(2).optional(),
    taxAmount: Joi.number().precision(2).optional(),
    total: Joi.number().precision(2).optional(),
    dueDate: Joi.date().iso().optional()
  }).min(1),
  querySchema,
  displayName: 'Document',
  searchFields: ['documentNumber'],

  onBeforeCreate: async (data, user, clinicDb) => {
    // Auto-generate documentNumber if not provided
    if (!data.documentNumber) {
      const Document = await getModel(clinicDb, 'Document');
      const count = await Document.count({
        where: { documentType: data.documentType, deletedAt: null }
      });

      const prefix = data.documentType === 'invoice' ? 'FA' : 'DV';
      const year = new Date().getFullYear();
      data.documentNumber = `${prefix}-${year}-${String(count + 1).padStart(4, '0')}`;
    }
    return data;
  },

  onAfterCreate: async (document, user, clinicDb) => {
    logger.info(`Document created: ${document.documentNumber}`, {
      documentId: document.id,
      type: document.documentType,
      patientId: document.patientId
    });
  }
});

router.use('/', documentRoutes);

// Send document to patient (with optional auto-send consents)
router.patch('/:id/send', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { sendEmail = true, sendConsents = false } = req.body;

    const Document = await getModel(req.clinicDb, 'Document');

    const document = await Document.findByPk(id, {
      where: { deletedAt: null }
    });
    if (!document) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }

    // Update status
    await document.update({
      status: 'sent',
      sentAt: new Date()
    });

    let createdConsents = [];

    // Handle auto-send consents if requested and appointment exists
    if (sendConsents && document.appointmentId) {
      try {
        // TODO: Implement consent auto-send with clinic-specific DB
        logger.info('Consent auto-send requested but not yet implemented for clinic isolation');
      } catch (error) {
        logger.warn('Failed to auto-send consents', {
          documentId: document.id,
          error: error.message
        });
        // Don't fail the document send if consent auto-send fails
      }
    }

    logger.info(`Document sent to patient`, {
      documentId: document.id,
      patientId: document.patientId,
      appointmentId: document.appointmentId,
      sendEmail,
      sendConsents,
      consentsCreated: createdConsents.length
    });

    res.json({
      success: true,
      data: document,
      consents: createdConsents,
      message: `Document sent successfully${createdConsents.length > 0 ? ` with ${createdConsents.length} consent(s) created` : ''}`
    });
  } catch (error) {
    next(error);
  }
});

// Convert quote to invoice (clinic-isolated)
router.post('/:id/convert-to-invoice', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { issueDate, dueDate } = req.body;

    const Document = await getModel(req.clinicDb, 'Document');

    const quote = await Document.findByPk(id, {
      where: { documentType: 'quote', deletedAt: null }
    });
    if (!quote) {
      return res.status(404).json({ success: false, error: { message: 'Quote not found' } });
    }

    // Create invoice from quote
    const invoiceCount = await Document.count({
      where: { documentType: 'invoice', deletedAt: null }
    });
    const year = new Date().getFullYear();
    const invoiceNumber = `FA-${year}-${String(invoiceCount + 1).padStart(4, '0')}`;

    const invoice = await Document.create({
      patientId: quote.patientId,
      appointmentId: quote.appointmentId,
      practitionerId: quote.practitionerId,
      documentType: 'invoice',
      documentNumber: invoiceNumber,
      issueDate: issueDate || new Date(),
      dueDate,
      items: quote.items,
      subtotal: quote.subtotal,
      taxAmount: quote.taxAmount,
      total: quote.total,
      status: 'draft'
    });

    logger.info(`Quote converted to invoice`, {
      quoteId: quote.id,
      invoiceId: invoice.id,
      patientId: quote.patientId
    });

    res.status(201).json({
      success: true,
      data: invoice,
      message: 'Quote converted to invoice successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

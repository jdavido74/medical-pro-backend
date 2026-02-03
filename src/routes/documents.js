/**
 * Documents Routes — Complete billing API
 *
 * CRUD + status actions + conversion + stats for quotes, invoices, credit notes.
 * All routes clinic-isolated via req.clinicDb / req.clinicId.
 */

const express = require('express');
const Joi = require('joi');
const { getModel } = require('../base/ModelFactory');
const { logger } = require('../utils/logger');
const { Op } = require('sequelize');
const documentService = require('../services/documentService');

const router = express.Router();

// ============================================================================
// Validation schemas
// ============================================================================

const addressSchema = Joi.object({
  line1: Joi.string().allow('', null),
  line2: Joi.string().allow('', null),
  postalCode: Joi.string().allow('', null),
  city: Joi.string().allow('', null),
  country: Joi.string().max(3).allow('', null)
}).allow(null);

const itemSchema = Joi.object({
  description: Joi.string().required(),
  quantity: Joi.number().min(0).default(1),
  unit: Joi.string().max(30).default('unit'),
  unitPrice: Joi.number().min(0).required(),
  unit_price: Joi.number().min(0),
  discountPercent: Joi.number().min(0).max(100).default(0),
  discount_percent: Joi.number().min(0).max(100),
  taxRate: Joi.number().min(0).max(100).default(0),
  tax_rate: Joi.number().min(0).max(100),
  taxCategoryCode: Joi.string().max(5).default('S'),
  tax_category_code: Joi.string().max(5),
  sortOrder: Joi.number().integer(),
  sort_order: Joi.number().integer(),
  productServiceId: Joi.string().uuid().allow(null),
  product_service_id: Joi.string().uuid().allow(null),
  productSnapshot: Joi.object().allow(null),
  product_snapshot: Joi.object().allow(null)
}).options({ allowUnknown: true });

const createSchema = Joi.object({
  // Type
  documentType: Joi.string().valid('invoice', 'quote', 'credit_note').required(),
  prefix: Joi.string().max(10).allow(null),

  // Seller
  sellerName: Joi.string().max(255).required(),
  sellerAddress: addressSchema,
  sellerSiren: Joi.string().max(14).allow('', null),
  sellerVatNumber: Joi.string().max(20).allow('', null),
  sellerLegalForm: Joi.string().max(100).allow('', null),
  sellerCapital: Joi.string().max(50).allow('', null),
  sellerRcs: Joi.string().max(100).allow('', null),
  sellerEmail: Joi.string().email({ tlds: false }).allow('', null),
  sellerPhone: Joi.string().max(20).allow('', null),

  // Buyer
  buyerName: Joi.string().max(255).required(),
  buyerAddress: addressSchema,
  buyerSiren: Joi.string().max(14).allow('', null),
  buyerVatNumber: Joi.string().max(20).allow('', null),
  buyerEmail: Joi.string().email({ tlds: false }).allow('', null),
  buyerPhone: Joi.string().max(20).allow('', null),

  // Dates
  issueDate: Joi.date().iso().required(),
  dueDate: Joi.date().iso().allow(null),
  validUntil: Joi.date().iso().allow(null),
  deliveryDate: Joi.date().iso().allow(null),

  // Items
  items: Joi.array().items(itemSchema).min(1).required(),

  // Discount
  discountType: Joi.string().valid('none', 'percentage', 'amount').default('none'),
  discountValue: Joi.number().min(0).default(0),

  // Conditions
  currency: Joi.string().max(3).default('EUR'),
  paymentTerms: Joi.string().allow('', null),
  paymentMethod: Joi.string().max(50).allow('', null),
  bankDetails: Joi.object().allow(null),
  latePenaltyRate: Joi.number().allow(null),
  recoveryIndemnity: Joi.number().allow(null),
  earlyPaymentDiscount: Joi.string().allow('', null),
  purchaseOrder: Joi.string().max(100).allow('', null),

  // Notes
  notes: Joi.string().allow('', null),
  terms: Joi.string().allow('', null),
  legalMentions: Joi.string().allow('', null),

  // E-invoicing
  transactionCategory: Joi.string().valid('goods', 'services', 'mixed').allow(null),
  vatOnDebits: Joi.boolean().default(false),
  facturxProfile: Joi.string().valid('MINIMUM', 'BASIC', 'EN16931', 'EXTENDED').allow(null),

  // Medical extensions (optional)
  patientId: Joi.string().uuid().allow(null),
  appointmentId: Joi.string().uuid().allow(null),
  practitionerId: Joi.string().uuid().allow(null)
}).options({ stripUnknown: true });

const updateSchema = Joi.object({
  // Same fields as create, all optional
  sellerName: Joi.string().max(255),
  sellerAddress: addressSchema,
  sellerSiren: Joi.string().max(14).allow('', null),
  sellerVatNumber: Joi.string().max(20).allow('', null),
  sellerLegalForm: Joi.string().max(100).allow('', null),
  sellerCapital: Joi.string().max(50).allow('', null),
  sellerRcs: Joi.string().max(100).allow('', null),
  sellerEmail: Joi.string().email({ tlds: false }).allow('', null),
  sellerPhone: Joi.string().max(20).allow('', null),

  buyerName: Joi.string().max(255),
  buyerAddress: addressSchema,
  buyerSiren: Joi.string().max(14).allow('', null),
  buyerVatNumber: Joi.string().max(20).allow('', null),
  buyerEmail: Joi.string().email({ tlds: false }).allow('', null),
  buyerPhone: Joi.string().max(20).allow('', null),

  issueDate: Joi.date().iso(),
  dueDate: Joi.date().iso().allow(null),
  validUntil: Joi.date().iso().allow(null),
  deliveryDate: Joi.date().iso().allow(null),

  items: Joi.array().items(itemSchema).min(1),

  discountType: Joi.string().valid('none', 'percentage', 'amount'),
  discountValue: Joi.number().min(0),

  currency: Joi.string().max(3),
  paymentTerms: Joi.string().allow('', null),
  paymentMethod: Joi.string().max(50).allow('', null),
  bankDetails: Joi.object().allow(null),
  latePenaltyRate: Joi.number().allow(null),
  recoveryIndemnity: Joi.number().allow(null),
  earlyPaymentDiscount: Joi.string().allow('', null),
  purchaseOrder: Joi.string().max(100).allow('', null),

  notes: Joi.string().allow('', null),
  terms: Joi.string().allow('', null),
  legalMentions: Joi.string().allow('', null),

  transactionCategory: Joi.string().valid('goods', 'services', 'mixed').allow(null),
  vatOnDebits: Joi.boolean(),
  facturxProfile: Joi.string().valid('MINIMUM', 'BASIC', 'EN16931', 'EXTENDED').allow(null),

  patientId: Joi.string().uuid().allow(null),
  appointmentId: Joi.string().uuid().allow(null),
  practitionerId: Joi.string().uuid().allow(null)
}).options({ stripUnknown: true }).min(1);

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(255).allow(''),
  documentType: Joi.string().valid('invoice', 'quote', 'credit_note'),
  status: Joi.string(),
  patientId: Joi.string().uuid(),
  practitionerId: Joi.string().uuid(),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  sortBy: Joi.string().valid('issue_date', 'document_number', 'total', 'status', 'created_at').default('created_at'),
  sortOrder: Joi.string().valid('ASC', 'DESC').default('DESC')
});

// ============================================================================
// CRUD Routes
// ============================================================================

/**
 * GET /documents
 * List documents with filters and pagination
 */
router.get('/', async (req, res, next) => {
  try {
    const { error, value: params } = querySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation error', details: error.details.map(d => d.message).join(', ') }
      });
    }

    const Document = await getModel(req.clinicDb, 'Document');
    const DocumentItem = await getModel(req.clinicDb, 'DocumentItem');

    const { page, limit, search, documentType, status, patientId, practitionerId,
            dateFrom, dateTo, sortBy, sortOrder } = params;

    const where = { deleted_at: null };

    if (documentType) where.document_type = documentType;
    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      where.status = statuses.length === 1 ? statuses[0] : { [Op.in]: statuses };
    }
    if (patientId) where.patient_id = patientId;
    if (practitionerId) where.practitioner_id = practitionerId;

    if (dateFrom || dateTo) {
      where.issue_date = {};
      if (dateFrom) where.issue_date[Op.gte] = dateFrom;
      if (dateTo) where.issue_date[Op.lte] = dateTo;
    }

    if (search) {
      where[Op.or] = [
        { document_number: { [Op.iLike]: `%${search}%` } },
        { buyer_name: { [Op.iLike]: `%${search}%` } },
        { seller_name: { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await Document.findAndCountAll({
      where,
      include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }],
      order: [[sortBy, sortOrder]],
      limit,
      offset,
      distinct: true
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
        hasNextPage: page < Math.ceil(count / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /documents/stats
 * Aggregate statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await documentService.getDocumentStats(
      req.clinicDb, req.clinicId, { documentType: req.query.documentType }
    );
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /documents/stats/monthly
 * Monthly revenue breakdown
 */
router.get('/stats/monthly', async (req, res, next) => {
  try {
    const year = req.query.year ? parseInt(req.query.year) : undefined;
    const data = await documentService.getMonthlyStats(req.clinicDb, req.clinicId, year);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /documents/next-number
 * Preview next document number
 */
router.get('/next-number', async (req, res, next) => {
  try {
    const { type, prefix } = req.query;
    if (!type || !['invoice', 'quote', 'credit_note'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Query param "type" is required (invoice, quote, credit_note)' }
      });
    }

    const nextNumber = await documentService.previewNextNumber(
      req.clinicDb, req.clinicId, type, prefix
    );

    res.json({ success: true, data: { nextNumber, type } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /documents/:id
 * Get document detail with items
 */
router.get('/:id', async (req, res, next) => {
  try {
    const Document = await getModel(req.clinicDb, 'Document');
    const DocumentItem = await getModel(req.clinicDb, 'DocumentItem');

    const doc = await Document.findByPk(req.params.id, {
      include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }]
    });

    if (!doc || doc.deleted_at) {
      return res.status(404).json({
        success: false,
        error: { message: 'Document not found' }
      });
    }

    res.json({ success: true, data: doc });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /documents
 * Create a new document (quote, invoice, or credit note)
 */
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation error', details: error.details.map(d => d.message).join(', ') }
      });
    }

    const doc = await documentService.createDocument(
      req.clinicDb, value, req.clinicId, req.user?.id
    );

    // Update appointment link if provided
    if (value.appointmentId) {
      try {
        const Appointment = await getModel(req.clinicDb, 'Appointment');
        const field = value.documentType === 'quote' ? 'quote_id' : 'invoice_id';
        await Appointment.update(
          { [field]: doc.id },
          { where: { id: value.appointmentId } }
        );
      } catch (linkErr) {
        logger.warn('Could not link document to appointment', {
          documentId: doc.id,
          appointmentId: value.appointmentId,
          error: linkErr.message
        });
      }
    }

    res.status(201).json({
      success: true,
      data: doc,
      message: `${value.documentType === 'quote' ? 'Quote' : value.documentType === 'invoice' ? 'Invoice' : 'Credit note'} created successfully`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /documents/:id
 * Update document (draft only)
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { error, value } = updateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation error', details: error.details.map(d => d.message).join(', ') }
      });
    }

    const doc = await documentService.updateDocument(req.clinicDb, req.params.id, value);

    res.json({
      success: true,
      data: doc,
      message: 'Document updated successfully'
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ success: false, error: { message: error.message } });
    }
    if (error.message.includes('Only draft')) {
      return res.status(409).json({ success: false, error: { message: error.message } });
    }
    next(error);
  }
});

/**
 * DELETE /documents/:id
 * Soft delete (draft only)
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const Document = await getModel(req.clinicDb, 'Document');

    const doc = await Document.findByPk(req.params.id);
    if (!doc || doc.deleted_at) {
      return res.status(404).json({
        success: false,
        error: { message: 'Document not found' }
      });
    }

    if (!doc.isDraft()) {
      return res.status(409).json({
        success: false,
        error: { message: 'Only draft documents can be deleted' }
      });
    }

    await doc.softDelete();

    logger.info('Document soft deleted', { documentId: doc.id, number: doc.document_number });

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Status Action Routes
// ============================================================================

/**
 * PATCH /documents/:id/send
 * Mark as sent
 */
router.patch('/:id/send', async (req, res, next) => {
  try {
    const Document = await getModel(req.clinicDb, 'Document');
    const doc = await Document.findByPk(req.params.id);

    if (!doc || doc.deleted_at) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }

    if (!documentService.canTransition(doc.document_type, doc.status, 'sent')) {
      return res.status(409).json({
        success: false,
        error: { message: `Cannot send a ${doc.document_type} with status "${doc.status}"` }
      });
    }

    await doc.update({ status: 'sent', sent_at: new Date() });

    logger.info('Document marked as sent', { documentId: doc.id, number: doc.document_number });

    res.json({ success: true, data: doc, message: 'Document sent successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /documents/:id/accept
 * Accept a quote
 */
router.patch('/:id/accept', async (req, res, next) => {
  try {
    const Document = await getModel(req.clinicDb, 'Document');
    const doc = await Document.findByPk(req.params.id);

    if (!doc || doc.deleted_at) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }

    if (doc.document_type !== 'quote') {
      return res.status(409).json({ success: false, error: { message: 'Only quotes can be accepted' } });
    }

    if (!documentService.canTransition(doc.document_type, doc.status, 'accepted')) {
      return res.status(409).json({
        success: false,
        error: { message: `Cannot accept a quote with status "${doc.status}"` }
      });
    }

    await doc.update({ status: 'accepted', accepted_at: new Date() });

    res.json({ success: true, data: doc, message: 'Quote accepted' });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /documents/:id/reject
 * Reject a quote
 */
router.patch('/:id/reject', async (req, res, next) => {
  try {
    const Document = await getModel(req.clinicDb, 'Document');
    const doc = await Document.findByPk(req.params.id);

    if (!doc || doc.deleted_at) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }

    if (doc.document_type !== 'quote') {
      return res.status(409).json({ success: false, error: { message: 'Only quotes can be rejected' } });
    }

    if (!documentService.canTransition(doc.document_type, doc.status, 'rejected')) {
      return res.status(409).json({
        success: false,
        error: { message: `Cannot reject a quote with status "${doc.status}"` }
      });
    }

    await doc.update({
      status: 'rejected',
      rejected_at: new Date(),
      notes: req.body.reason ? `${doc.notes || ''}\nRejet: ${req.body.reason}`.trim() : doc.notes
    });

    res.json({ success: true, data: doc, message: 'Quote rejected' });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /documents/:id/pay
 * Mark invoice as paid (full or partial)
 */
router.patch('/:id/pay', async (req, res, next) => {
  try {
    const Document = await getModel(req.clinicDb, 'Document');
    const doc = await Document.findByPk(req.params.id);

    if (!doc || doc.deleted_at) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }

    if (doc.document_type !== 'invoice') {
      return res.status(409).json({ success: false, error: { message: 'Only invoices can be marked as paid' } });
    }

    const paymentAmount = parseFloat(req.body.amount) || parseFloat(doc.amount_due) || 0;
    const newAmountPaid = parseFloat(doc.amount_paid) + paymentAmount;
    const totalDue = parseFloat(doc.total);
    const newAmountDue = Math.max(0, totalDue - newAmountPaid);
    const isFullyPaid = newAmountDue <= 0;

    const newStatus = isFullyPaid ? 'paid' : 'partial';

    if (!documentService.canTransition(doc.document_type, doc.status, newStatus)) {
      return res.status(409).json({
        success: false,
        error: { message: `Cannot mark as ${newStatus} an invoice with status "${doc.status}"` }
      });
    }

    const updateData = {
      status: newStatus,
      amount_paid: Math.min(newAmountPaid, totalDue),
      amount_due: newAmountDue,
      payment_method: req.body.paymentMethod || req.body.payment_method || doc.payment_method
    };

    if (isFullyPaid) {
      updateData.paid_at = new Date();
    }

    await doc.update(updateData);

    res.json({ success: true, data: doc, message: isFullyPaid ? 'Invoice fully paid' : 'Partial payment recorded' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Conversion & Duplication
// ============================================================================

/**
 * POST /documents/:id/convert
 * Convert quote to invoice
 */
router.post('/:id/convert', async (req, res, next) => {
  try {
    const result = await documentService.convertQuoteToInvoice(
      req.clinicDb, req.params.id, req.clinicId, {
        ...req.body,
        createdBy: req.user?.id
      }
    );

    // Update appointment link
    if (result.invoice.appointment_id) {
      try {
        const Appointment = await getModel(req.clinicDb, 'Appointment');
        await Appointment.update(
          { invoice_id: result.invoice.id },
          { where: { id: result.invoice.appointment_id } }
        );
      } catch (linkErr) {
        logger.warn('Could not link invoice to appointment', { error: linkErr.message });
      }
    }

    res.status(201).json({
      success: true,
      data: result.invoice,
      sourceQuote: { id: result.quote.id, number: result.quote.document_number },
      message: 'Quote converted to invoice successfully'
    });
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('not a quote')) {
      return res.status(404).json({ success: false, error: { message: error.message } });
    }
    if (error.message.includes('Only accepted') || error.message.includes('deleted')) {
      return res.status(409).json({ success: false, error: { message: error.message } });
    }
    next(error);
  }
});

/**
 * POST /documents/:id/credit-note
 * Create credit note from invoice
 */
router.post('/:id/credit-note', async (req, res, next) => {
  try {
    const creditNote = await documentService.createCreditNote(
      req.clinicDb, req.params.id, req.clinicId, {
        ...req.body,
        createdBy: req.user?.id
      }
    );

    res.status(201).json({
      success: true,
      data: creditNote,
      message: 'Credit note created successfully'
    });
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('not an invoice')) {
      return res.status(404).json({ success: false, error: { message: error.message } });
    }
    if (error.message.includes('must be sent')) {
      return res.status(409).json({ success: false, error: { message: error.message } });
    }
    next(error);
  }
});

/**
 * POST /documents/:id/duplicate
 * Duplicate a document as new draft
 */
router.post('/:id/duplicate', async (req, res, next) => {
  try {
    const doc = await documentService.duplicateDocument(
      req.clinicDb, req.params.id, req.clinicId, req.user?.id
    );

    res.status(201).json({
      success: true,
      data: doc,
      message: 'Document duplicated successfully'
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ success: false, error: { message: error.message } });
    }
    next(error);
  }
});

/**
 * GET /documents/:id/pdf
 * Generate / download PDF (placeholder — Factur-X in Phase 4)
 */
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const Document = await getModel(req.clinicDb, 'Document');
    const DocumentItem = await getModel(req.clinicDb, 'DocumentItem');

    const doc = await Document.findByPk(req.params.id, {
      include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }]
    });

    if (!doc || doc.deleted_at) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }

    // Phase 4 will implement full Factur-X PDF generation.
    // For now, return the document data for client-side PDF rendering.
    res.json({
      success: true,
      data: doc,
      message: 'PDF generation will be available in a future update. Use client-side rendering.'
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Billing Settings Routes
// ============================================================================

/**
 * GET /documents/billing-settings
 * Read billing configuration from clinic_settings
 */
router.get('/billing-settings', async (req, res, next) => {
  try {
    const [result] = await req.clinicDb.query(
      `SELECT billing_settings FROM clinic_settings WHERE facility_id = :clinicId`,
      { replacements: { clinicId: req.clinicId } }
    );

    const settings = result.length > 0 ? (result[0].billing_settings || {}) : {};

    res.json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /documents/billing-settings
 * Update billing configuration
 */
router.put('/billing-settings', async (req, res, next) => {
  try {
    const billingSettings = req.body;

    const [result] = await req.clinicDb.query(
      `UPDATE clinic_settings
       SET billing_settings = :settings, updated_at = CURRENT_TIMESTAMP
       WHERE facility_id = :clinicId
       RETURNING billing_settings`,
      {
        replacements: {
          clinicId: req.clinicId,
          settings: JSON.stringify(billingSettings)
        }
      }
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Clinic settings not found' }
      });
    }

    res.json({
      success: true,
      data: result[0].billing_settings,
      message: 'Billing settings updated successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

/**
 * Document Service — Business logic for billing documents
 *
 * Generic billing engine (no medical dependency).
 * Handles: totals calculation, sequential numbering, document creation,
 * quote-to-invoice conversion, credit notes, statistics.
 */

const { getModel } = require('../base/ModelFactory');
const { logger } = require('../utils/logger');

// ============================================================================
// Totals calculation
// ============================================================================

/**
 * Calculate line-level amounts from raw item data
 * @param {Object} item - { quantity, unitPrice, discountPercent, taxRate }
 * @returns {Object} - { lineNetAmount, taxAmount }
 */
function calculateLineAmounts(item) {
  const qty = parseFloat(item.quantity) || 0;
  const unitPrice = parseFloat(item.unitPrice || item.unit_price) || 0;
  const discountPct = parseFloat(item.discountPercent || item.discount_percent) || 0;

  const grossAmount = qty * unitPrice;
  const lineNetAmount = grossAmount * (1 - discountPct / 100);
  const taxRate = parseFloat(item.taxRate || item.tax_rate) || 0;
  const taxAmount = lineNetAmount * (taxRate / 100);

  return {
    lineNetAmount: round2(lineNetAmount),
    taxAmount: round2(taxAmount)
  };
}

/**
 * Calculate document-level totals from items + optional global discount
 * @param {Array} items - Array of item objects
 * @param {Object} discount - { type: 'none'|'percentage'|'amount', value: number }
 * @returns {Object} - { subtotal, discountAmount, taxAmount, taxDetails, total, amountDue, items }
 */
function calculateDocumentTotals(items, discount = { type: 'none', value: 0 }) {
  // Compute per-line amounts
  const computedItems = (items || []).map((item, idx) => {
    const { lineNetAmount, taxAmount } = calculateLineAmounts(item);
    return {
      ...item,
      sort_order: item.sortOrder ?? item.sort_order ?? idx,
      line_net_amount: lineNetAmount,
      tax_amount: taxAmount
    };
  });

  // Subtotal = sum of line net amounts (before global discount)
  const subtotal = round2(computedItems.reduce((sum, it) => sum + it.line_net_amount, 0));

  // Global discount
  let discountAmount = 0;
  const discountType = discount.type || 'none';
  const discountValue = parseFloat(discount.value) || 0;

  if (discountType === 'percentage') {
    discountAmount = round2(subtotal * discountValue / 100);
  } else if (discountType === 'amount') {
    discountAmount = round2(Math.min(discountValue, subtotal));
  }

  // Tax details grouped by rate
  const taxMap = {};
  for (const item of computedItems) {
    const rate = parseFloat(item.taxRate || item.tax_rate) || 0;
    const catCode = item.taxCategoryCode || item.tax_category_code || 'S';
    const key = `${rate}_${catCode}`;
    if (!taxMap[key]) {
      taxMap[key] = { rate, categoryCode: catCode, base: 0, amount: 0 };
    }
    taxMap[key].base += item.line_net_amount;
    taxMap[key].amount += item.tax_amount;
  }

  // Apply proportional discount to tax bases if global discount exists
  if (discountAmount > 0 && subtotal > 0) {
    const discountRatio = discountAmount / subtotal;
    for (const key of Object.keys(taxMap)) {
      const entry = taxMap[key];
      const baseReduction = round2(entry.base * discountRatio);
      entry.base = round2(entry.base - baseReduction);
      entry.amount = round2(entry.base * entry.rate / 100);
    }
  }

  const taxDetails = Object.values(taxMap).map(t => ({
    rate: t.rate,
    categoryCode: t.categoryCode,
    base: t.base,
    amount: t.amount
  }));

  const taxAmount = round2(taxDetails.reduce((sum, t) => sum + t.amount, 0));
  const total = round2(subtotal - discountAmount + taxAmount);

  return {
    subtotal,
    discountType,
    discountValue,
    discountAmount,
    taxAmount,
    taxDetails,
    total,
    amountDue: total,
    items: computedItems
  };
}

// ============================================================================
// Sequential numbering
// ============================================================================

/**
 * Get next document number using the sequence table.
 * Uses a transaction with row-level locking (SELECT ... FOR UPDATE)
 * to guarantee gap-free sequential numbering.
 *
 * @param {Sequelize} clinicDb
 * @param {string} facilityId
 * @param {string} documentType - 'invoice' | 'quote' | 'credit_note'
 * @param {Object} [options] - { prefix, transaction }
 * @returns {Promise<{ number: string, sequenceNumber: number }>}
 */
async function getNextNumber(clinicDb, facilityId, documentType, options = {}) {
  const year = new Date().getFullYear();
  const defaultPrefixes = { invoice: 'FA', quote: 'DV', credit_note: 'AV' };
  const prefix = options.prefix || defaultPrefixes[documentType] || 'DOC';

  const DocumentSequence = await getModel(clinicDb, 'DocumentSequence');

  // Use provided transaction or create one
  const executeInTransaction = async (t) => {
    // Try to find and lock the sequence row
    let seq = await DocumentSequence.findOne({
      where: { facility_id: facilityId, document_type: documentType, year },
      lock: t.LOCK.UPDATE,
      transaction: t
    });

    if (!seq) {
      // Create sequence row if it doesn't exist
      seq = await DocumentSequence.create({
        facility_id: facilityId,
        document_type: documentType,
        prefix,
        year,
        last_number: 0
      }, { transaction: t });
    }

    const nextNumber = seq.last_number + 1;
    await seq.update({ last_number: nextNumber, prefix }, { transaction: t });

    const documentNumber = `${prefix}-${year}-${String(nextNumber).padStart(4, '0')}`;
    return { number: documentNumber, sequenceNumber: nextNumber };
  };

  if (options.transaction) {
    return executeInTransaction(options.transaction);
  }

  return clinicDb.transaction(executeInTransaction);
}

/**
 * Preview the next document number without consuming it.
 */
async function previewNextNumber(clinicDb, facilityId, documentType, prefix) {
  const year = new Date().getFullYear();
  const defaultPrefixes = { invoice: 'FA', quote: 'DV', credit_note: 'AV' };
  const pfx = prefix || defaultPrefixes[documentType] || 'DOC';

  const DocumentSequence = await getModel(clinicDb, 'DocumentSequence');

  const seq = await DocumentSequence.findOne({
    where: { facility_id: facilityId, document_type: documentType, year }
  });

  const nextNumber = (seq ? seq.last_number : 0) + 1;
  return `${pfx}-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// ============================================================================
// Document CRUD helpers
// ============================================================================

/**
 * Create a document with its items in a single transaction.
 *
 * @param {Sequelize} clinicDb
 * @param {Object} data - Document data including items[]
 * @param {string} facilityId
 * @param {string} [createdBy] - User ID
 * @returns {Promise<Object>} - Created document with items
 */
async function createDocument(clinicDb, data, facilityId, createdBy) {
  const Document = await getModel(clinicDb, 'Document');
  const DocumentItem = await getModel(clinicDb, 'DocumentItem');

  return clinicDb.transaction(async (t) => {
    // Generate sequential number
    const { number: documentNumber } = await getNextNumber(
      clinicDb, facilityId, data.documentType || data.document_type,
      { prefix: data.prefix, transaction: t }
    );

    // Calculate totals
    const totals = calculateDocumentTotals(data.items || [], {
      type: data.discountType || data.discount_type || 'none',
      value: data.discountValue || data.discount_value || 0
    });

    // Create document
    const doc = await Document.create({
      facility_id: facilityId,
      document_type: data.documentType || data.document_type,
      document_number: documentNumber,
      prefix: data.prefix,

      // Seller
      seller_name: data.sellerName || data.seller_name,
      seller_address: data.sellerAddress || data.seller_address || {},
      seller_siren: data.sellerSiren || data.seller_siren,
      seller_vat_number: data.sellerVatNumber || data.seller_vat_number,
      seller_legal_form: data.sellerLegalForm || data.seller_legal_form,
      seller_capital: data.sellerCapital || data.seller_capital,
      seller_rcs: data.sellerRcs || data.seller_rcs,
      seller_email: data.sellerEmail || data.seller_email,
      seller_phone: data.sellerPhone || data.seller_phone,

      // Buyer
      buyer_name: data.buyerName || data.buyer_name,
      buyer_address: data.buyerAddress || data.buyer_address || {},
      buyer_siren: data.buyerSiren || data.buyer_siren,
      buyer_vat_number: data.buyerVatNumber || data.buyer_vat_number,
      buyer_email: data.buyerEmail || data.buyer_email,
      buyer_phone: data.buyerPhone || data.buyer_phone,

      // Dates
      issue_date: data.issueDate || data.issue_date,
      due_date: data.dueDate || data.due_date,
      valid_until: data.validUntil || data.valid_until,
      delivery_date: data.deliveryDate || data.delivery_date,

      // Amounts (computed)
      currency: data.currency || 'EUR',
      subtotal: totals.subtotal,
      discount_type: totals.discountType,
      discount_value: totals.discountValue,
      discount_amount: totals.discountAmount,
      tax_amount: totals.taxAmount,
      tax_details: totals.taxDetails,
      total: totals.total,
      amount_paid: 0,
      amount_due: totals.total,

      // Conditions
      payment_terms: data.paymentTerms || data.payment_terms,
      payment_method: data.paymentMethod || data.payment_method,
      bank_details: data.bankDetails || data.bank_details,
      late_penalty_rate: data.latePenaltyRate || data.late_penalty_rate,
      recovery_indemnity: data.recoveryIndemnity || data.recovery_indemnity,
      early_payment_discount: data.earlyPaymentDiscount || data.early_payment_discount,
      purchase_order: data.purchaseOrder || data.purchase_order,

      // Notes
      notes: data.notes,
      terms: data.terms,
      legal_mentions: data.legalMentions || data.legal_mentions,

      // E-invoicing
      transaction_category: data.transactionCategory || data.transaction_category,
      vat_on_debits: data.vatOnDebits || data.vat_on_debits || false,
      facturx_profile: data.facturxProfile || data.facturx_profile,

      // Medical extensions
      patient_id: data.patientId || data.patient_id || null,
      appointment_id: data.appointmentId || data.appointment_id || null,
      practitioner_id: data.practitionerId || data.practitioner_id || null,

      created_by: createdBy,
      status: 'draft'
    }, { transaction: t });

    // Create items
    if (totals.items.length > 0) {
      const itemRecords = totals.items.map((item, idx) => ({
        document_id: doc.id,
        sort_order: item.sort_order ?? idx,
        description: item.description,
        quantity: parseFloat(item.quantity) || 1,
        unit: item.unit || 'unit',
        unit_price: parseFloat(item.unitPrice || item.unit_price) || 0,
        discount_percent: parseFloat(item.discountPercent || item.discount_percent) || 0,
        tax_rate: parseFloat(item.taxRate || item.tax_rate) || 0,
        tax_category_code: item.taxCategoryCode || item.tax_category_code || 'S',
        line_net_amount: item.line_net_amount,
        tax_amount: item.tax_amount,
        product_service_id: item.productServiceId || item.product_service_id || null,
        product_snapshot: item.productSnapshot || item.product_snapshot || null
      }));

      await DocumentItem.bulkCreate(itemRecords, { transaction: t });
    }

    // Reload with items
    const result = await Document.findByPk(doc.id, {
      include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }],
      transaction: t
    });

    logger.info('Document created', {
      documentId: doc.id,
      documentNumber,
      type: doc.document_type,
      total: totals.total
    });

    return result;
  });
}

/**
 * Update a document (only if draft). Replaces all items.
 */
async function updateDocument(clinicDb, documentId, data) {
  const Document = await getModel(clinicDb, 'Document');
  const DocumentItem = await getModel(clinicDb, 'DocumentItem');

  return clinicDb.transaction(async (t) => {
    const doc = await Document.findByPk(documentId, { transaction: t });
    if (!doc) throw new Error('Document not found');
    if (!doc.isDraft()) throw new Error('Only draft documents can be edited');
    if (doc.deleted_at) throw new Error('Document has been deleted');

    // Recalculate totals if items provided
    let totals = null;
    if (data.items) {
      totals = calculateDocumentTotals(data.items, {
        type: data.discountType || data.discount_type || doc.discount_type,
        value: data.discountValue || data.discount_value || doc.discount_value
      });
    } else if (data.discountType !== undefined || data.discountValue !== undefined ||
               data.discount_type !== undefined || data.discount_value !== undefined) {
      // Discount changed but items not provided — reload items from DB
      const existingItems = await DocumentItem.findAll({
        where: { document_id: documentId },
        order: [['sort_order', 'ASC']],
        transaction: t
      });
      totals = calculateDocumentTotals(existingItems.map(i => i.get()), {
        type: data.discountType || data.discount_type,
        value: data.discountValue || data.discount_value
      });
    }

    // Build update payload
    const updatePayload = {};

    // Seller fields
    const sellerFields = ['seller_name', 'seller_address', 'seller_siren', 'seller_vat_number',
      'seller_legal_form', 'seller_capital', 'seller_rcs', 'seller_email', 'seller_phone'];
    const buyerFields = ['buyer_name', 'buyer_address', 'buyer_siren', 'buyer_vat_number',
      'buyer_email', 'buyer_phone'];
    const dateFields = ['issue_date', 'due_date', 'valid_until', 'delivery_date'];
    const conditionFields = ['payment_terms', 'payment_method', 'bank_details',
      'late_penalty_rate', 'recovery_indemnity', 'early_payment_discount', 'purchase_order'];
    const noteFields = ['notes', 'terms', 'legal_mentions'];
    const einvoiceFields = ['transaction_category', 'vat_on_debits', 'facturx_profile'];
    const medicalFields = ['patient_id', 'appointment_id', 'practitioner_id'];

    const allFields = [...sellerFields, ...buyerFields, ...dateFields,
      ...conditionFields, ...noteFields, ...einvoiceFields, ...medicalFields, 'currency'];

    for (const field of allFields) {
      // Accept both camelCase and snake_case
      const camelKey = snakeToCamel(field);
      const val = data[field] !== undefined ? data[field] : data[camelKey];
      if (val !== undefined) {
        updatePayload[field] = val;
      }
    }

    // Apply computed totals
    if (totals) {
      updatePayload.subtotal = totals.subtotal;
      updatePayload.discount_type = totals.discountType;
      updatePayload.discount_value = totals.discountValue;
      updatePayload.discount_amount = totals.discountAmount;
      updatePayload.tax_amount = totals.taxAmount;
      updatePayload.tax_details = totals.taxDetails;
      updatePayload.total = totals.total;
      updatePayload.amount_due = totals.total - parseFloat(doc.amount_paid || 0);
    }

    await doc.update(updatePayload, { transaction: t });

    // Replace items if provided
    if (data.items && totals) {
      await DocumentItem.destroy({ where: { document_id: documentId }, transaction: t });

      const itemRecords = totals.items.map((item, idx) => ({
        document_id: documentId,
        sort_order: item.sort_order ?? idx,
        description: item.description,
        quantity: parseFloat(item.quantity) || 1,
        unit: item.unit || 'unit',
        unit_price: parseFloat(item.unitPrice || item.unit_price) || 0,
        discount_percent: parseFloat(item.discountPercent || item.discount_percent) || 0,
        tax_rate: parseFloat(item.taxRate || item.tax_rate) || 0,
        tax_category_code: item.taxCategoryCode || item.tax_category_code || 'S',
        line_net_amount: item.line_net_amount,
        tax_amount: item.tax_amount,
        product_service_id: item.productServiceId || item.product_service_id || null,
        product_snapshot: item.productSnapshot || item.product_snapshot || null
      }));

      await DocumentItem.bulkCreate(itemRecords, { transaction: t });
    }

    const result = await Document.findByPk(documentId, {
      include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }],
      transaction: t
    });

    logger.info('Document updated', { documentId, number: doc.document_number });
    return result;
  });
}

// ============================================================================
// Status transitions
// ============================================================================

const ALLOWED_TRANSITIONS = {
  // Quotes
  'quote:draft': ['sent'],
  'quote:sent': ['accepted', 'rejected'],
  'quote:accepted': ['converted'],
  // Invoices
  'invoice:draft': ['sent'],
  'invoice:sent': ['paid', 'partial', 'overdue', 'cancelled'],
  'invoice:partial': ['paid', 'overdue', 'cancelled'],
  'invoice:overdue': ['paid', 'partial', 'cancelled'],
  // Credit notes
  'credit_note:draft': ['sent'],
  'credit_note:sent': ['applied']
};

function canTransition(documentType, currentStatus, newStatus) {
  const key = `${documentType}:${currentStatus}`;
  const allowed = ALLOWED_TRANSITIONS[key] || [];
  return allowed.includes(newStatus);
}

// ============================================================================
// Conversion: Quote -> Invoice
// ============================================================================

async function convertQuoteToInvoice(clinicDb, quoteId, facilityId, data = {}) {
  const Document = await getModel(clinicDb, 'Document');
  const DocumentItem = await getModel(clinicDb, 'DocumentItem');

  return clinicDb.transaction(async (t) => {
    const quote = await Document.findByPk(quoteId, {
      include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }],
      transaction: t
    });

    if (!quote) throw new Error('Quote not found');
    if (quote.deleted_at) throw new Error('Quote has been deleted');
    if (quote.document_type !== 'quote') throw new Error('Document is not a quote');
    if (!['accepted', 'sent'].includes(quote.status)) {
      throw new Error('Only accepted or sent quotes can be converted');
    }

    // Generate invoice number
    const { number: invoiceNumber } = await getNextNumber(
      clinicDb, facilityId, 'invoice',
      { prefix: data.prefix, transaction: t }
    );

    // Create invoice copying from quote
    const invoice = await Document.create({
      facility_id: facilityId,
      document_type: 'invoice',
      document_number: invoiceNumber,
      prefix: data.prefix || 'FA',

      seller_name: quote.seller_name,
      seller_address: quote.seller_address,
      seller_siren: quote.seller_siren,
      seller_vat_number: quote.seller_vat_number,
      seller_legal_form: quote.seller_legal_form,
      seller_capital: quote.seller_capital,
      seller_rcs: quote.seller_rcs,
      seller_email: quote.seller_email,
      seller_phone: quote.seller_phone,

      buyer_name: quote.buyer_name,
      buyer_address: quote.buyer_address,
      buyer_siren: quote.buyer_siren,
      buyer_vat_number: quote.buyer_vat_number,
      buyer_email: quote.buyer_email,
      buyer_phone: quote.buyer_phone,

      issue_date: data.issueDate || data.issue_date || new Date(),
      due_date: data.dueDate || data.due_date || null,
      delivery_date: data.deliveryDate || data.delivery_date || null,

      currency: quote.currency,
      subtotal: quote.subtotal,
      discount_type: quote.discount_type,
      discount_value: quote.discount_value,
      discount_amount: quote.discount_amount,
      tax_amount: quote.tax_amount,
      tax_details: quote.tax_details,
      total: quote.total,
      amount_paid: 0,
      amount_due: quote.total,

      payment_terms: data.paymentTerms || data.payment_terms || quote.payment_terms,
      payment_method: data.paymentMethod || data.payment_method || quote.payment_method,
      bank_details: data.bankDetails || data.bank_details || quote.bank_details,
      late_penalty_rate: quote.late_penalty_rate,
      recovery_indemnity: quote.recovery_indemnity,
      early_payment_discount: quote.early_payment_discount,
      purchase_order: data.purchaseOrder || data.purchase_order || quote.purchase_order,

      notes: data.notes || quote.notes,
      terms: quote.terms,
      legal_mentions: quote.legal_mentions,

      transaction_category: quote.transaction_category,
      vat_on_debits: quote.vat_on_debits,
      facturx_profile: quote.facturx_profile,

      patient_id: quote.patient_id,
      appointment_id: quote.appointment_id,
      practitioner_id: quote.practitioner_id,

      converted_from_id: quote.id,
      created_by: data.createdBy || data.created_by,
      status: 'draft'
    }, { transaction: t });

    // Copy items
    if (quote.items && quote.items.length > 0) {
      const itemRecords = quote.items.map(item => ({
        document_id: invoice.id,
        sort_order: item.sort_order,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        tax_rate: item.tax_rate,
        tax_category_code: item.tax_category_code,
        line_net_amount: item.line_net_amount,
        tax_amount: item.tax_amount,
        product_service_id: item.product_service_id,
        product_snapshot: item.product_snapshot
      }));

      await DocumentItem.bulkCreate(itemRecords, { transaction: t });
    }

    // Update quote status
    await quote.update({
      status: 'converted',
      converted_at: new Date(),
      converted_to_id: invoice.id
    }, { transaction: t });

    // Reload invoice with items
    const result = await Document.findByPk(invoice.id, {
      include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }],
      transaction: t
    });

    logger.info('Quote converted to invoice', {
      quoteId: quote.id,
      quoteNumber: quote.document_number,
      invoiceId: invoice.id,
      invoiceNumber
    });

    return { invoice: result, quote };
  });
}

// ============================================================================
// Credit Note from Invoice
// ============================================================================

async function createCreditNote(clinicDb, invoiceId, facilityId, data = {}) {
  const Document = await getModel(clinicDb, 'Document');
  const DocumentItem = await getModel(clinicDb, 'DocumentItem');

  return clinicDb.transaction(async (t) => {
    const invoice = await Document.findByPk(invoiceId, {
      include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }],
      transaction: t
    });

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.document_type !== 'invoice') throw new Error('Document is not an invoice');
    if (!['sent', 'paid', 'partial', 'overdue'].includes(invoice.status)) {
      throw new Error('Invoice must be sent or paid to create a credit note');
    }

    const { number: creditNumber } = await getNextNumber(
      clinicDb, facilityId, 'credit_note',
      { prefix: data.prefix || 'AV', transaction: t }
    );

    const creditNote = await Document.create({
      facility_id: facilityId,
      document_type: 'credit_note',
      document_number: creditNumber,
      prefix: data.prefix || 'AV',

      seller_name: invoice.seller_name,
      seller_address: invoice.seller_address,
      seller_siren: invoice.seller_siren,
      seller_vat_number: invoice.seller_vat_number,
      seller_legal_form: invoice.seller_legal_form,
      seller_capital: invoice.seller_capital,
      seller_rcs: invoice.seller_rcs,
      seller_email: invoice.seller_email,
      seller_phone: invoice.seller_phone,

      buyer_name: invoice.buyer_name,
      buyer_address: invoice.buyer_address,
      buyer_siren: invoice.buyer_siren,
      buyer_vat_number: invoice.buyer_vat_number,
      buyer_email: invoice.buyer_email,
      buyer_phone: invoice.buyer_phone,

      issue_date: new Date(),
      currency: invoice.currency,
      subtotal: invoice.subtotal,
      discount_type: invoice.discount_type,
      discount_value: invoice.discount_value,
      discount_amount: invoice.discount_amount,
      tax_amount: invoice.tax_amount,
      tax_details: invoice.tax_details,
      total: invoice.total,
      amount_due: invoice.total,

      notes: data.notes || data.reason || `Avoir sur facture ${invoice.document_number}`,
      terms: invoice.terms,
      legal_mentions: invoice.legal_mentions,

      transaction_category: invoice.transaction_category,
      vat_on_debits: invoice.vat_on_debits,
      facturx_profile: invoice.facturx_profile,

      patient_id: invoice.patient_id,
      appointment_id: invoice.appointment_id,
      practitioner_id: invoice.practitioner_id,

      converted_from_id: invoice.id,
      created_by: data.createdBy || data.created_by,
      status: 'draft'
    }, { transaction: t });

    // Copy items
    if (invoice.items && invoice.items.length > 0) {
      const itemRecords = invoice.items.map(item => ({
        document_id: creditNote.id,
        sort_order: item.sort_order,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        tax_rate: item.tax_rate,
        tax_category_code: item.tax_category_code,
        line_net_amount: item.line_net_amount,
        tax_amount: item.tax_amount,
        product_service_id: item.product_service_id,
        product_snapshot: item.product_snapshot
      }));

      await DocumentItem.bulkCreate(itemRecords, { transaction: t });
    }

    const result = await Document.findByPk(creditNote.id, {
      include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }],
      transaction: t
    });

    logger.info('Credit note created', {
      creditNoteId: creditNote.id,
      creditNoteNumber: creditNumber,
      invoiceId: invoice.id
    });

    return result;
  });
}

// ============================================================================
// Duplicate
// ============================================================================

async function duplicateDocument(clinicDb, documentId, facilityId, createdBy) {
  const Document = await getModel(clinicDb, 'Document');
  const DocumentItem = await getModel(clinicDb, 'DocumentItem');

  const source = await Document.findByPk(documentId, {
    include: [{ model: DocumentItem, as: 'items', order: [['sort_order', 'ASC']] }]
  });

  if (!source) throw new Error('Document not found');

  // Re-create as a new draft with fresh number
  const itemsData = (source.items || []).map(item => ({
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price,
    discount_percent: item.discount_percent,
    tax_rate: item.tax_rate,
    tax_category_code: item.tax_category_code,
    product_service_id: item.product_service_id,
    product_snapshot: item.product_snapshot
  }));

  const data = {
    document_type: source.document_type,
    prefix: source.prefix,
    seller_name: source.seller_name,
    seller_address: source.seller_address,
    seller_siren: source.seller_siren,
    seller_vat_number: source.seller_vat_number,
    seller_legal_form: source.seller_legal_form,
    seller_capital: source.seller_capital,
    seller_rcs: source.seller_rcs,
    seller_email: source.seller_email,
    seller_phone: source.seller_phone,
    buyer_name: source.buyer_name,
    buyer_address: source.buyer_address,
    buyer_siren: source.buyer_siren,
    buyer_vat_number: source.buyer_vat_number,
    buyer_email: source.buyer_email,
    buyer_phone: source.buyer_phone,
    issue_date: new Date(),
    currency: source.currency,
    discount_type: source.discount_type,
    discount_value: source.discount_value,
    payment_terms: source.payment_terms,
    payment_method: source.payment_method,
    bank_details: source.bank_details,
    late_penalty_rate: source.late_penalty_rate,
    recovery_indemnity: source.recovery_indemnity,
    early_payment_discount: source.early_payment_discount,
    notes: source.notes,
    terms: source.terms,
    legal_mentions: source.legal_mentions,
    transaction_category: source.transaction_category,
    vat_on_debits: source.vat_on_debits,
    facturx_profile: source.facturx_profile,
    patient_id: source.patient_id,
    practitioner_id: source.practitioner_id,
    items: itemsData
  };

  return createDocument(clinicDb, data, facilityId, createdBy);
}

// ============================================================================
// Statistics
// ============================================================================

async function getDocumentStats(clinicDb, facilityId, filters = {}) {
  const Document = await getModel(clinicDb, 'Document');
  const { Op, fn, col, literal } = require('sequelize');

  const where = { facility_id: facilityId, deleted_at: null };
  if (filters.documentType) where.document_type = filters.documentType;

  // By status
  const statusCounts = await Document.findAll({
    attributes: [
      'document_type',
      'status',
      [fn('COUNT', col('id')), 'count'],
      [fn('SUM', col('total')), 'total_amount']
    ],
    where,
    group: ['document_type', 'status'],
    raw: true
  });

  // Totals
  const overallTotals = await Document.findAll({
    attributes: [
      'document_type',
      [fn('COUNT', col('id')), 'count'],
      [fn('SUM', col('total')), 'total_amount'],
      [fn('SUM', col('amount_paid')), 'total_paid']
    ],
    where,
    group: ['document_type'],
    raw: true
  });

  // Overdue invoices
  const overdueCount = await Document.count({
    where: {
      ...where,
      document_type: 'invoice',
      status: { [Op.in]: ['sent', 'partial'] },
      due_date: { [Op.lt]: new Date() }
    }
  });

  return { byStatus: statusCounts, totals: overallTotals, overdueCount };
}

async function getMonthlyStats(clinicDb, facilityId, year) {
  const targetYear = year || new Date().getFullYear();
  const Document = await getModel(clinicDb, 'Document');
  const { fn, col, literal } = require('sequelize');

  const monthlyRevenue = await Document.findAll({
    attributes: [
      [fn('EXTRACT', literal("MONTH FROM issue_date")), 'month'],
      [fn('SUM', col('total')), 'total'],
      [fn('SUM', col('amount_paid')), 'paid'],
      [fn('COUNT', col('id')), 'count']
    ],
    where: {
      facility_id: facilityId,
      document_type: 'invoice',
      deleted_at: null,
      issue_date: {
        [require('sequelize').Op.between]: [
          `${targetYear}-01-01`,
          `${targetYear}-12-31`
        ]
      }
    },
    group: [fn('EXTRACT', literal("MONTH FROM issue_date"))],
    order: [[fn('EXTRACT', literal("MONTH FROM issue_date")), 'ASC']],
    raw: true
  });

  return monthlyRevenue;
}

// ============================================================================
// Helpers
// ============================================================================

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  calculateLineAmounts,
  calculateDocumentTotals,
  getNextNumber,
  previewNextNumber,
  createDocument,
  updateDocument,
  canTransition,
  convertQuoteToInvoice,
  createCreditNote,
  duplicateDocument,
  getDocumentStats,
  getMonthlyStats
};

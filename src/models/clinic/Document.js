/**
 * Clinic Document Model — Unified quotes / invoices / credit notes
 *
 * Generic billing model (works without medical context).
 * Medical extensions (patient_id, appointment_id, practitioner_id) are optional.
 *
 * Uses facility_id for clinic isolation, deleted_at for soft delete.
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

function createDocumentModel(clinicDb) {
  const Document = ClinicBaseModel.create(clinicDb, 'Document', {
    facility_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'medical_facilities', key: 'id' },
      onDelete: 'CASCADE'
    },

    // -- Identity --
    document_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [['invoice', 'quote', 'credit_note']] }
    },
    document_number: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    prefix: {
      type: DataTypes.STRING(10),
      allowNull: true
    },

    // -- Seller snapshot (frozen at creation, EN 16931) --
    seller_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    seller_address: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    },
    seller_siren: { type: DataTypes.STRING(14), allowNull: true },
    seller_vat_number: { type: DataTypes.STRING(20), allowNull: true },
    seller_legal_form: { type: DataTypes.STRING(100), allowNull: true },
    seller_capital: { type: DataTypes.STRING(50), allowNull: true },
    seller_rcs: { type: DataTypes.STRING(100), allowNull: true },
    seller_email: { type: DataTypes.STRING(255), allowNull: true },
    seller_phone: { type: DataTypes.STRING(20), allowNull: true },

    // -- Buyer snapshot --
    buyer_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    buyer_address: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    },
    buyer_siren: { type: DataTypes.STRING(14), allowNull: true },
    buyer_vat_number: { type: DataTypes.STRING(20), allowNull: true },
    buyer_email: { type: DataTypes.STRING(255), allowNull: true },
    buyer_phone: { type: DataTypes.STRING(20), allowNull: true },

    // -- Dates --
    issue_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    due_date: { type: DataTypes.DATEONLY, allowNull: true },
    valid_until: { type: DataTypes.DATEONLY, allowNull: true },
    delivery_date: { type: DataTypes.DATEONLY, allowNull: true },

    // -- Amounts --
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'EUR'
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    discount_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'none',
      validate: { isIn: [['none', 'percentage', 'amount']] }
    },
    discount_value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0
    },
    discount_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    tax_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    tax_details: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    total: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    amount_paid: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    amount_due: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },

    // -- Payment conditions --
    payment_terms: { type: DataTypes.TEXT, allowNull: true },
    payment_method: { type: DataTypes.STRING(50), allowNull: true },
    bank_details: { type: DataTypes.JSONB, allowNull: true },
    late_penalty_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    recovery_indemnity: { type: DataTypes.DECIMAL(10, 2), allowNull: true, defaultValue: 40 },
    early_payment_discount: { type: DataTypes.TEXT, allowNull: true },
    purchase_order: { type: DataTypes.STRING(100), allowNull: true },

    // -- Status --
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'draft',
      validate: {
        isIn: [['draft', 'sent', 'accepted', 'rejected', 'expired',
                'paid', 'partial', 'overdue', 'cancelled', 'converted', 'applied']]
      }
    },

    // -- Traceability timestamps --
    sent_at: { type: DataTypes.DATE, allowNull: true },
    accepted_at: { type: DataTypes.DATE, allowNull: true },
    rejected_at: { type: DataTypes.DATE, allowNull: true },
    paid_at: { type: DataTypes.DATE, allowNull: true },
    converted_at: { type: DataTypes.DATE, allowNull: true },
    converted_from_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'documents', key: 'id' },
      onDelete: 'SET NULL'
    },
    converted_to_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'documents', key: 'id' },
      onDelete: 'SET NULL'
    },

    // -- Notes --
    notes: { type: DataTypes.TEXT, allowNull: true },
    terms: { type: DataTypes.TEXT, allowNull: true },
    legal_mentions: { type: DataTypes.TEXT, allowNull: true },

    // -- E-invoicing (reform 2026) --
    transaction_category: { type: DataTypes.STRING(20), allowNull: true },
    vat_on_debits: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    facturx_profile: { type: DataTypes.STRING(30), allowNull: true },
    facturx_xml: { type: DataTypes.TEXT, allowNull: true },

    // -- Medical extensions (optional) --
    patient_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'patients', key: 'id' },
      onDelete: 'SET NULL'
    },
    appointment_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'appointments', key: 'id' },
      onDelete: 'SET NULL'
    },
    practitioner_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'healthcare_providers', key: 'id' },
      onDelete: 'SET NULL'
    },

    // -- Metadata --
    created_by: { type: DataTypes.UUID, allowNull: true },
    deleted_at: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'documents',
    indexes: [
      { fields: ['facility_id'] },
      { fields: ['document_type'] },
      { fields: ['status'] },
      { fields: ['patient_id'] },
      { fields: ['appointment_id'] },
      { fields: ['practitioner_id'] },
      { fields: ['issue_date'] },
      { fields: ['due_date'] },
      { fields: ['document_number'] },
      { fields: ['deleted_at'] },
      { fields: ['converted_from_id'] },
      { fields: ['converted_to_id'] }
    ]
  });

  // -- Instance methods --

  Document.prototype.isDraft = function () {
    return this.status === 'draft';
  };

  Document.prototype.isEditable = function () {
    return this.status === 'draft';
  };

  Document.prototype.softDelete = async function () {
    this.deleted_at = new Date();
    return await this.save();
  };

  Document.prototype.isDeleted = function () {
    return this.deleted_at !== null;
  };

  // -- Static methods --

  Document.findActive = async function (options = {}) {
    return await this.findAll({
      where: { deleted_at: null, ...options.where },
      ...options
    });
  };

  return Document;
}

module.exports = createDocumentModel;

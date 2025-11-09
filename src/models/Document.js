const BaseModel = require('../base/BaseModel');
const { DataTypes } = require('sequelize');

const Document = BaseModel.create('Document', {
  patient_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'patients', key: 'id' }
  },
  appointment_id: {
    type: DataTypes.UUID,
    references: { model: 'appointments', key: 'id' }
  },
  practitioner_id: {
    type: DataTypes.UUID,
    references: { model: 'practitioners', key: 'id' }
  },
  document_type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: { isIn: [['quote', 'invoice']] }
  },
  document_number: { type: DataTypes.STRING(50), allowNull: false },
  issue_date: { type: DataTypes.DATE, allowNull: false },
  due_date: { type: DataTypes.DATE },
  items: { type: DataTypes.JSONB, defaultValue: [] },
  subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'draft',
    validate: { isIn: [['draft', 'sent', 'accepted', 'rejected', 'paid', 'cancelled']] }
  },
  sent_at: { type: DataTypes.DATE },
  accepted_at: { type: DataTypes.DATE }
}, { tableName: 'documents', indexes: [{ fields: ['patient_id'] }, { fields: ['appointment_id'] }, { fields: ['document_type'] }, { fields: ['status'] }, { name: 'documents_number_unique', unique: true, fields: ['company_id', 'document_number'], where: { deleted_at: null } }] });

module.exports = Document;

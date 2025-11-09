const BaseModel = require('../base/BaseModel');
const { DataTypes } = require('sequelize');

const Consent = BaseModel.create('Consent', {
  patient_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'patients', key: 'id' } },
  appointment_id: { type: DataTypes.UUID, references: { model: 'appointments', key: 'id' } },
  product_service_id: { type: DataTypes.UUID, references: { model: 'product_services', key: 'id' } },
  consent_template_id: { type: DataTypes.UUID, references: { model: 'consent_templates', key: 'id' } },
  consent_type: { type: DataTypes.STRING(50), allowNull: false, validate: { isIn: [['medical_treatment', 'data_processing', 'photo', 'communication']] } },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  terms: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.STRING(20), defaultValue: 'pending', validate: { isIn: [['pending', 'accepted', 'rejected']] } },
  signed_at: { type: DataTypes.DATE },
  signature_method: { type: DataTypes.STRING(20), validate: { isIn: [['digital', 'checkbox', 'pin']] } },
  ip_address: { type: DataTypes.STRING(45) },
  device_info: { type: DataTypes.JSONB, defaultValue: {} },
  related_document_id: { type: DataTypes.UUID, references: { model: 'documents', key: 'id' } }
}, { tableName: 'consents', indexes: [{ fields: ['patient_id'] }, { fields: ['status'] }, { fields: ['consent_type'] }, { fields: ['patient_id', 'status'] }] });

module.exports = Consent;

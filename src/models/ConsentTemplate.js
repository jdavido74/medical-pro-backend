const BaseModel = require('../base/BaseModel');
const { DataTypes } = require('sequelize');

const ConsentTemplate = BaseModel.create('ConsentTemplate', {
  code: { type: DataTypes.STRING(100), allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  terms: { type: DataTypes.TEXT, allowNull: false },
  version: { type: DataTypes.STRING(20), defaultValue: '1.0' },
  consent_type: { type: DataTypes.STRING(50), allowNull: false, validate: { isIn: [['medical_treatment', 'data_processing', 'photo', 'communication']] } },
  is_mandatory: { type: DataTypes.BOOLEAN, defaultValue: false },
  auto_send: { type: DataTypes.BOOLEAN, defaultValue: false },
  valid_from: { type: DataTypes.DATE, allowNull: false },
  valid_until: { type: DataTypes.DATE }
}, { tableName: 'consent_templates', indexes: [{ fields: ['consent_type'] }, { name: 'template_code_unique', unique: true, fields: ['company_id', 'code'], where: { deleted_at: null } }] });

module.exports = ConsentTemplate;

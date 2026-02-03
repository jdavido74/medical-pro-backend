/**
 * Clinic DocumentSequence Model — Sequential numbering
 *
 * Guarantees unique, sequential, gap-free document numbers (legal requirement).
 * One row per (facility_id, document_type, year).
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

function createDocumentSequenceModel(clinicDb) {
  const DocumentSequence = ClinicBaseModel.create(clinicDb, 'DocumentSequence', {
    facility_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'medical_facilities', key: 'id' },
      onDelete: 'CASCADE'
    },
    document_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [['invoice', 'quote', 'credit_note']] }
    },
    prefix: {
      type: DataTypes.STRING(10),
      allowNull: false
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    last_number: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    }
  }, {
    tableName: 'document_sequences',
    indexes: [
      { fields: ['facility_id', 'document_type', 'year'], unique: true }
    ]
  });

  return DocumentSequence;
}

module.exports = createDocumentSequenceModel;

/**
 * Clinic DocumentItem Model — Line items for documents
 *
 * Relational table (not JSONB) to support queries, reporting, and catalog links.
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

function createDocumentItemModel(clinicDb) {
  const DocumentItem = ClinicBaseModel.create(clinicDb, 'DocumentItem', {
    document_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'documents', key: 'id' },
      onDelete: 'CASCADE'
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },

    // Content
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    quantity: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: false,
      defaultValue: 1
    },
    unit: {
      type: DataTypes.STRING(30),
      allowNull: true,
      defaultValue: 'unit'
    },
    unit_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    discount_percent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0
    },
    tax_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0
    },
    tax_category_code: {
      type: DataTypes.STRING(5),
      allowNull: false,
      defaultValue: 'S'
    },

    // Computed
    line_net_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    tax_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },

    // Catalog reference (optional)
    product_service_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    product_snapshot: {
      type: DataTypes.JSONB,
      allowNull: true
    }
  }, {
    tableName: 'document_items',
    indexes: [
      { fields: ['document_id'] },
      { fields: ['document_id', 'sort_order'] },
      { fields: ['product_service_id'] }
    ]
  });

  return DocumentItem;
}

module.exports = createDocumentItemModel;

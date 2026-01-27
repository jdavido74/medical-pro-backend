const { DataTypes } = require('sequelize');

/**
 * ProductSupplier model factory
 * Junction table for Product-Supplier many-to-many relationship
 * @param {Sequelize} sequelize - Database Sequelize instance
 */
module.exports = (sequelize) => {
  const ProductSupplier = sequelize.define('ProductSupplier', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    // Foreign keys
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products_services',
        key: 'id'
      }
    },
    supplier_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'suppliers',
        key: 'id'
      }
    },

    // Relationship metadata
    is_primary: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    supplier_sku: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    unit_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    currency: {
      type: DataTypes.CHAR(3),
      defaultValue: 'EUR'
    },
    min_order_quantity: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    lead_time_days: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Timestamps
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    }
  }, {
    tableName: 'product_suppliers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      { fields: ['product_id'] },
      { fields: ['supplier_id'] },
      {
        fields: ['product_id', 'supplier_id'],
        unique: true
      }
    ]
  });

  return ProductSupplier;
};

/**
 * Transform ProductSupplier data from API to DB format
 * @param {Object} data - API format data (camelCase)
 * @returns {Object} DB format data (snake_case)
 */
module.exports.transformProductSupplierToDb = (data) => {
  const dbData = {};

  const fieldMap = {
    productId: 'product_id',
    supplierId: 'supplier_id',
    isPrimary: 'is_primary',
    supplierSku: 'supplier_sku',
    unitCost: 'unit_cost',
    currency: 'currency',
    minOrderQuantity: 'min_order_quantity',
    leadTimeDays: 'lead_time_days',
    notes: 'notes'
  };

  for (const [apiKey, dbKey] of Object.entries(fieldMap)) {
    if (data[apiKey] !== undefined) {
      dbData[dbKey] = data[apiKey];
    }
  }

  return dbData;
};

/**
 * Transform ProductSupplier data from DB to API format
 * @param {Object} data - DB format data
 * @returns {Object} API format data (camelCase)
 */
module.exports.transformProductSupplierToApi = (data) => {
  if (!data) return null;

  const raw = data.toJSON ? data.toJSON() : data;

  return {
    id: raw.id,
    productId: raw.product_id,
    supplierId: raw.supplier_id,
    isPrimary: raw.is_primary,
    supplierSku: raw.supplier_sku,
    unitCost: raw.unit_cost ? parseFloat(raw.unit_cost) : null,
    currency: raw.currency,
    minOrderQuantity: raw.min_order_quantity,
    leadTimeDays: raw.lead_time_days,
    notes: raw.notes,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    // Include nested supplier if available
    supplier: raw.supplier ? require('./Supplier').transformSupplierToApi(raw.supplier) : undefined
  };
};

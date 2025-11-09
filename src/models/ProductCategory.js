const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

module.exports = () => {
  const ProductCategory = sequelize.define('ProductCategory', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    product_service_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products_services',
        key: 'id'
      }
    },
    category_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'categories',
        key: 'id'
      }
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    }
  }, {
    tableName: 'product_categories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    underscored: true,
    indexes: [
      {
        fields: ['product_service_id', 'category_id'],
        unique: true
      }
    ]
  });

  return ProductCategory;
};
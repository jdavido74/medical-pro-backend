const { DataTypes } = require('sequelize');

/**
 * Category model factory
 * Used for categorizing products, treatments, services across the SaaS
 * @param {Sequelize} sequelize - Clinic database Sequelize instance
 */
module.exports = (sequelize) => {
  const Category = sequelize.define('Category', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 100]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    color: {
      type: DataTypes.STRING(7),
      allowNull: true,
      validate: {
        is: /^#[0-9A-F]{6}$/i
      },
      defaultValue: '#3B82F6'
    },
    // Category type for filtering (medication, treatment, service, etc.)
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'product',
      validate: {
        isIn: [['product', 'medication', 'treatment', 'service', 'appointment', 'other']]
      }
    },
    // Display order
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false
      // Note: No FK reference - company_id is stored for audit purposes
      // but the companies table exists in the central DB, not clinic DBs
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    }
  }, {
    tableName: 'categories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        fields: ['company_id']
      },
      {
        fields: ['name', 'company_id'],
        unique: true
      }
    ]
  });

  // Associations are handled by ModelFactory.setupAssociations()
  // Category ↔ ProductService (many-to-many through product_categories)

  return Category;
};
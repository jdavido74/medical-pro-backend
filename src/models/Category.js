const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

module.exports = () => {
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
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'companies',
        key: 'id'
      }
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

  Category.associate = (models) => {
    Category.belongsTo(models.Company, {
      foreignKey: 'company_id',
      as: 'company'
    });

    Category.belongsToMany(models.ProductService, {
      through: 'product_categories',
      foreignKey: 'category_id',
      otherKey: 'product_service_id',
      as: 'products'
    });
  };

  return Category;
};
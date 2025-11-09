const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

module.exports = () => {
  const ProductService = sequelize.define('ProductService', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 200]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: [['product', 'service']]
      }
    },
    unit_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'EUR',
      validate: {
        len: [3, 3]
      }
    },
    unit: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'unité'
    },
    sku: {
      type: DataTypes.STRING(100),
      allowNull: true,
      validate: {
        len: [0, 100]
      }
    },
    tax_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 20.00,
      validate: {
        min: 0,
        max: 100
      }
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
    tableName: 'products_services',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        fields: ['company_id']
      },
      {
        fields: ['type']
      },
      {
        fields: ['sku', 'company_id'],
        unique: true,
        where: {
          sku: {
            [sequelize.Sequelize.Op.ne]: null
          }
        }
      }
    ]
  });

  ProductService.associate = (models) => {
    ProductService.belongsTo(models.Company, {
      foreignKey: 'company_id',
      as: 'company'
    });

    ProductService.belongsToMany(models.Category, {
      through: 'product_categories',
      foreignKey: 'product_service_id',
      otherKey: 'category_id',
      as: 'categories'
    });

    ProductService.hasMany(models.InvoiceItem, {
      foreignKey: 'product_service_id',
      as: 'invoice_items'
    });

    ProductService.hasMany(models.QuoteItem, {
      foreignKey: 'product_service_id',
      as: 'quote_items'
    });
  };

  return ProductService;
};
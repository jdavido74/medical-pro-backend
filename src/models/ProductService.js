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
    // Legacy type field (product/service)
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: [['product', 'service']]
      }
    },
    // Medical-specific item type (product, medication, treatment, service)
    item_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'product',
      validate: {
        isIn: [['product', 'medication', 'treatment', 'service']]
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

    // === Medical-specific fields ===

    // Duration in minutes (for services/treatments - impacts appointments)
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 5,
        max: 480
      }
    },

    // Preparation time before treatment (minutes)
    prep_before: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 120
      }
    },

    // Time after treatment (minutes)
    prep_after: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 120
      }
    },

    // Dosage amount (for medications and treatments)
    dosage: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },

    // Dosage unit (mg, ml, g, ui, mcg)
    dosage_unit: {
      type: DataTypes.STRING(10),
      allowNull: true,
      validate: {
        isIn: [['mg', 'ml', 'g', 'ui', 'mcg', null]]
      }
    },

    // Volume in ml (for treatments)
    volume: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },

    // Provenance/origin (for medications and treatments)
    provenance: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },

    // Can this treatment overlap with others (no machine required)
    is_overlappable: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    // Machine type required (will reference machine_types table)
    machine_type_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },

    // === Family/Variant support ===

    // Parent item ID for variants (self-reference)
    parent_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'products_services',
        key: 'id'
      }
    },

    // True if this item is a family with variants
    is_family: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    // True if this item is a variant of a family
    is_variant: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
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
        fields: ['item_type']
      },
      {
        fields: ['parent_id']
      },
      {
        fields: ['machine_type_id']
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

    // Self-reference for family/variant relationship
    ProductService.belongsTo(ProductService, {
      foreignKey: 'parent_id',
      as: 'parent'
    });

    ProductService.hasMany(ProductService, {
      foreignKey: 'parent_id',
      as: 'variants'
    });
  };

  return ProductService;
};

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DocumentItem = sequelize.define('DocumentItem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  document_id: {
    type: DataTypes.UUID,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  document_type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: {
      isIn: [['invoice', 'quote']]
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 1000]
    }
  },
  quantity: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false,
    defaultValue: 1,
    validate: {
      min: 0.001,
      isDecimal: true
    }
  },
  unit_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0,
      isDecimal: true
    }
  },
  tax_rate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true, // null = utilise le taux par défaut du pays
    validate: {
      min: 0,
      max: 100,
      isDecimal: true
    }
  },
  total: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0,
      isDecimal: true
    }
  },
  unit: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'unité',
    validate: {
      len: [1, 20]
    }
  },
  order_index: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  product_service_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'products_services',
      key: 'id'
    }
  },
  price_locked_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'document_items',
  timestamps: true,
  indexes: [
    {
      fields: ['document_id', 'document_type']
    },
    {
      fields: ['document_id', 'order_index']
    }
  ],
  hooks: {
    beforeValidate: (item, options) => {
      // Calculer le total automatiquement
      if (item.quantity && item.unit_price) {
        item.total = (parseFloat(item.quantity) * parseFloat(item.unit_price)).toFixed(2);
      }

      // Nettoyer la description
      if (item.description) {
        item.description = item.description.trim();
      }

      // Nettoyer l'unité
      if (item.unit) {
        item.unit = item.unit.trim().toLowerCase();
      }
    }
  }
});

// Méthodes d'instance
DocumentItem.prototype.toSafeJSON = function() {
  const values = Object.assign({}, this.get());
  return values;
};

DocumentItem.prototype.calculateTotal = function() {
  return parseFloat((this.quantity * this.unit_price).toFixed(2));
};

DocumentItem.prototype.calculateTaxAmount = function(defaultTaxRate = 20) {
  const taxRate = this.tax_rate !== null ? this.tax_rate : defaultTaxRate;
  return parseFloat(((this.total * taxRate) / 100).toFixed(2));
};

DocumentItem.prototype.getTotalWithTax = function(defaultTaxRate = 20) {
  return parseFloat((this.total + this.calculateTaxAmount(defaultTaxRate)).toFixed(2));
};

DocumentItem.prototype.getDisplayDescription = function() {
  return this.description;
};

DocumentItem.prototype.getDisplayUnit = function() {
  return this.unit || 'unité';
};

// Méthodes statiques
DocumentItem.findByDocument = async function(documentId, documentType) {
  return await this.findAll({
    where: {
      document_id: documentId,
      document_type: documentType
    },
    order: [['order_index', 'ASC']]
  });
};

DocumentItem.bulkCreateForDocument = async function(documentId, documentType, items, transaction = null) {
  // Préparer les données avec order_index
  const itemsWithOrder = items.map((item, index) => ({
    ...item,
    document_id: documentId,
    document_type: documentType,
    order_index: index
  }));

  return await this.bulkCreate(itemsWithOrder, {
    transaction,
    validate: true
  });
};

DocumentItem.updateItemsForDocument = async function(documentId, documentType, items, transaction = null) {
  // Supprimer les items existants
  await this.destroy({
    where: {
      document_id: documentId,
      document_type: documentType
    },
    transaction
  });

  // Créer les nouveaux items
  if (items && items.length > 0) {
    return await this.bulkCreateForDocument(documentId, documentType, items, transaction);
  }

  return [];
};

DocumentItem.calculateDocumentTotals = async function(documentId, documentType, defaultTaxRate = 20) {
  const items = await this.findByDocument(documentId, documentType);

  let subtotal = 0;
  let totalTax = 0;
  const taxDetails = {};

  items.forEach(item => {
    subtotal += parseFloat(item.total);

    const taxRate = item.tax_rate !== null ? item.tax_rate : defaultTaxRate;
    const taxAmount = parseFloat(((item.total * taxRate) / 100).toFixed(2));

    totalTax += taxAmount;

    // Grouper par taux de TVA
    const rateKey = `${taxRate}%`;
    if (!taxDetails[rateKey]) {
      taxDetails[rateKey] = {
        rate: taxRate,
        base: 0,
        amount: 0
      };
    }
    taxDetails[rateKey].base += parseFloat(item.total);
    taxDetails[rateKey].amount += taxAmount;
  });

  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    tax_amount: parseFloat(totalTax.toFixed(2)),
    total: parseFloat((subtotal + totalTax).toFixed(2)),
    tax_details: taxDetails,
    items_count: items.length
  };
};

DocumentItem.copyFromDocument = async function(sourceDocumentId, sourceType, targetDocumentId, targetType, transaction = null) {
  const sourceItems = await this.findByDocument(sourceDocumentId, sourceType);

  if (sourceItems.length === 0) {
    return [];
  }

  // Préparer les données pour la copie
  const itemsData = sourceItems.map(item => ({
    document_id: targetDocumentId,
    document_type: targetType,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: item.tax_rate,
    total: item.total,
    unit: item.unit,
    order_index: item.order_index
  }));

  return await this.bulkCreate(itemsData, {
    transaction,
    validate: true
  });
};

module.exports = DocumentItem;
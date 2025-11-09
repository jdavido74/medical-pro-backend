const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Quote = sequelize.define('Quote', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  company_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'companies',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  client_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'clients',
      key: 'id'
    },
    onDelete: 'SET NULL'
  },
  number: {
    type: DataTypes.STRING(50),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 50]
    }
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'draft',
    validate: {
      isIn: [['draft', 'sent', 'accepted', 'rejected', 'converted', 'expired']]
    }
  },
  quote_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    validate: {
      isDate: true
    }
  },
  valid_until: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    validate: {
      isDate: true,
      isAfterQuoteDate(value) {
        if (value && this.quote_date && new Date(value) < new Date(this.quote_date)) {
          throw new Error('Valid until date must be after quote date');
        }
      }
    }
  },
  subtotal: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0,
      isDecimal: true
    }
  },
  discount_type: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: {
      isIn: [['percentage', 'amount', 'none']]
    }
  },
  discount_value: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0,
      isDecimal: true,
      isValidDiscount(value) {
        if (value !== null && value !== undefined) {
          if (this.discount_type === 'percentage' && value > 100) {
            throw new Error('Percentage discount cannot exceed 100%');
          }
          if (this.discount_type === 'amount' && value > this.subtotal) {
            throw new Error('Amount discount cannot exceed subtotal');
          }
        }
      }
    }
  },
  tax_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0,
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
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'EUR',
    validate: {
      isIn: [['EUR', 'USD', 'GBP', 'CHF']]
    }
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  terms: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  converted_invoice_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'invoices',
      key: 'id'
    }
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  accepted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejected_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  converted_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'quotes',
  timestamps: true,
  indexes: [
    {
      name: 'quotes_company_number_unique',
      unique: true,
      fields: ['company_id', 'number']
    },
    {
      fields: ['company_id']
    },
    {
      fields: ['client_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['quote_date']
    },
    {
      fields: ['valid_until']
    },
    {
      fields: ['total']
    },
    {
      fields: ['converted_invoice_id']
    }
  ],
  hooks: {
    beforeValidate: (quote, options) => {
      // Normaliser le numéro
      if (quote.number) {
        quote.number = quote.number.trim().toUpperCase();
      }

      // Calculer la date de validité si pas fournie (30 jours par défaut)
      if (quote.quote_date && !quote.valid_until) {
        const quoteDate = new Date(quote.quote_date);
        quoteDate.setDate(quoteDate.getDate() + 30);
        quote.valid_until = quoteDate.toISOString().split('T')[0];
      }
    },
    beforeUpdate: (quote, options) => {
      // Mettre à jour les timestamps selon le statut
      if (quote.changed('status')) {
        const now = new Date();

        if (quote.status === 'sent' && !quote.sent_at) {
          quote.sent_at = now;
        }

        if (quote.status === 'accepted' && !quote.accepted_at) {
          quote.accepted_at = now;
        }

        if (quote.status === 'rejected' && !quote.rejected_at) {
          quote.rejected_at = now;
        }

        if (quote.status === 'converted' && !quote.converted_at) {
          quote.converted_at = now;
        }
      }
    }
  }
});

// Méthodes d'instance
Quote.prototype.toSafeJSON = function() {
  const values = Object.assign({}, this.get());
  return values;
};

Quote.prototype.getDisplayNumber = function() {
  return this.number;
};

Quote.prototype.isExpired = function() {
  if (this.status === 'converted' || this.status === 'accepted' || !this.valid_until) {
    return false;
  }

  const today = new Date();
  const validUntil = new Date(this.valid_until);
  return validUntil < today;
};

Quote.prototype.getDaysUntilExpiry = function() {
  if (!this.valid_until) {
    return null;
  }

  const today = new Date();
  const validUntil = new Date(this.valid_until);
  const diffTime = validUntil - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

Quote.prototype.calculateDiscount = function() {
  if (!this.discount_type || this.discount_type === 'none' || !this.discount_value) {
    return 0;
  }

  if (this.discount_type === 'percentage') {
    return (this.subtotal * this.discount_value) / 100;
  }

  if (this.discount_type === 'amount') {
    return Math.min(this.discount_value, this.subtotal);
  }

  return 0;
};

Quote.prototype.getAmountAfterDiscount = function() {
  return this.subtotal - this.calculateDiscount();
};

Quote.prototype.canBeModified = function() {
  return this.status === 'draft';
};

Quote.prototype.canBeSent = function() {
  return ['draft', 'sent'].includes(this.status);
};

Quote.prototype.canBeConverted = function() {
  return ['sent', 'accepted'].includes(this.status);
};

Quote.prototype.canBeAccepted = function() {
  return this.status === 'sent' && !this.isExpired();
};

Quote.prototype.canBeRejected = function() {
  return this.status === 'sent';
};

// Méthodes statiques
Quote.findByCompany = async function(companyId, options = {}) {
  return await this.findAll({
    where: {
      company_id: companyId,
      ...options.where
    },
    include: [
      {
        association: 'client',
        required: false
      },
      {
        association: 'items',
        required: false
      },
      {
        association: 'convertedInvoice',
        required: false
      }
    ],
    order: [['quote_date', 'DESC']],
    ...options
  });
};

Quote.findExpired = async function(companyId) {
  const { Op } = require('sequelize');
  return await this.findAll({
    where: {
      company_id: companyId,
      status: {
        [Op.in]: ['sent']
      },
      valid_until: {
        [Op.lt]: new Date()
      }
    },
    include: ['client'],
    order: [['valid_until', 'ASC']]
  });
};

Quote.getTotalsByStatus = async function(companyId) {
  const results = await this.findAll({
    where: { company_id: companyId },
    attributes: [
      'status',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      [sequelize.fn('SUM', sequelize.col('total')), 'total_amount']
    ],
    group: ['status'],
    raw: true
  });

  // Transformer en objet pour faciliter l'usage
  const totals = {
    draft: { count: 0, total_amount: 0 },
    sent: { count: 0, total_amount: 0 },
    accepted: { count: 0, total_amount: 0 },
    rejected: { count: 0, total_amount: 0 },
    converted: { count: 0, total_amount: 0 },
    expired: { count: 0, total_amount: 0 }
  };

  results.forEach(result => {
    totals[result.status] = {
      count: parseInt(result.count),
      total_amount: parseFloat(result.total_amount) || 0
    };
  });

  return totals;
};

Quote.getConversionStats = async function(companyId, period = 'month') {
  const { Op } = require('sequelize');

  let dateCondition;
  const now = new Date();

  if (period === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    dateCondition = { [Op.gte]: startOfMonth };
  } else if (period === 'year') {
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    dateCondition = { [Op.gte]: startOfYear };
  }

  const stats = await this.findAll({
    where: {
      company_id: companyId,
      ...(dateCondition && { created_at: dateCondition })
    },
    attributes: [
      [sequelize.fn('COUNT', sequelize.col('id')), 'total_quotes'],
      [
        sequelize.fn('COUNT',
          sequelize.literal("CASE WHEN status = 'accepted' THEN 1 END")
        ),
        'accepted_quotes'
      ],
      [
        sequelize.fn('COUNT',
          sequelize.literal("CASE WHEN status = 'converted' THEN 1 END")
        ),
        'converted_quotes'
      ],
      [sequelize.fn('AVG', sequelize.col('total')), 'average_value']
    ],
    raw: true
  });

  const result = stats[0];
  const totalQuotes = parseInt(result.total_quotes) || 0;
  const acceptedQuotes = parseInt(result.accepted_quotes) || 0;
  const convertedQuotes = parseInt(result.converted_quotes) || 0;

  return {
    total_quotes: totalQuotes,
    accepted_quotes: acceptedQuotes,
    converted_quotes: convertedQuotes,
    acceptance_rate: totalQuotes > 0 ? (acceptedQuotes / totalQuotes) * 100 : 0,
    conversion_rate: totalQuotes > 0 ? (convertedQuotes / totalQuotes) * 100 : 0,
    average_value: parseFloat(result.average_value) || 0
  };
};

module.exports = Quote;
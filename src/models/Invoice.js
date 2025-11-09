const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Invoice = sequelize.define('Invoice', {
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
      isIn: [['draft', 'sent', 'paid', 'overdue', 'cancelled']]
    }
  },
  issue_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    validate: {
      isDate: true
    }
  },
  due_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    validate: {
      isDate: true,
      isAfterIssueDate(value) {
        if (value && this.issue_date && new Date(value) < new Date(this.issue_date)) {
          throw new Error('Due date must be after issue date');
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
  payment_conditions: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  purchase_order: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  paid_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'invoices',
  timestamps: true,
  indexes: [
    {
      name: 'invoices_company_number_unique',
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
      fields: ['issue_date']
    },
    {
      fields: ['due_date']
    },
    {
      fields: ['total']
    }
  ],
  hooks: {
    beforeValidate: (invoice, options) => {
      // Normaliser le numéro
      if (invoice.number) {
        invoice.number = invoice.number.trim().toUpperCase();
      }

      // Calculer la date d'échéance si pas fournie
      if (invoice.issue_date && !invoice.due_date && invoice.client_id) {
        // Sera calculé avec les termes de paiement du client
        // Pour l'instant, défaut à 30 jours
        const issueDate = new Date(invoice.issue_date);
        issueDate.setDate(issueDate.getDate() + 30);
        invoice.due_date = issueDate.toISOString().split('T')[0];
      }
    },
    beforeUpdate: (invoice, options) => {
      // Mettre à jour les timestamps selon le statut
      if (invoice.changed('status')) {
        const now = new Date();

        if (invoice.status === 'sent' && !invoice.sent_at) {
          invoice.sent_at = now;
        }

        if (invoice.status === 'paid' && !invoice.paid_at) {
          invoice.paid_at = now;
        }
      }
    }
  }
});

// Méthodes d'instance
Invoice.prototype.toSafeJSON = function() {
  const values = Object.assign({}, this.get());
  return values;
};

Invoice.prototype.getDisplayNumber = function() {
  return this.number;
};

Invoice.prototype.isOverdue = function() {
  if (this.status === 'paid' || !this.due_date) {
    return false;
  }

  const today = new Date();
  const dueDate = new Date(this.due_date);
  return dueDate < today;
};

Invoice.prototype.getDaysOverdue = function() {
  if (!this.isOverdue()) {
    return 0;
  }

  const today = new Date();
  const dueDate = new Date(this.due_date);
  const diffTime = today - dueDate;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

Invoice.prototype.calculateDiscount = function() {
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

Invoice.prototype.getAmountAfterDiscount = function() {
  return this.subtotal - this.calculateDiscount();
};

Invoice.prototype.canBeModified = function() {
  return this.status === 'draft';
};

Invoice.prototype.canBeSent = function() {
  return ['draft', 'sent'].includes(this.status);
};

Invoice.prototype.canBePaid = function() {
  return ['sent', 'overdue'].includes(this.status);
};

// Méthodes statiques
Invoice.findByCompany = async function(companyId, options = {}) {
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
      }
    ],
    order: [['issue_date', 'DESC']],
    ...options
  });
};

Invoice.findOverdue = async function(companyId) {
  const { Op } = require('sequelize');
  return await this.findAll({
    where: {
      company_id: companyId,
      status: {
        [Op.in]: ['sent', 'overdue']
      },
      due_date: {
        [Op.lt]: new Date()
      }
    },
    include: ['client'],
    order: [['due_date', 'ASC']]
  });
};

Invoice.getTotalsByStatus = async function(companyId) {
  const { Op } = require('sequelize');

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
    paid: { count: 0, total_amount: 0 },
    overdue: { count: 0, total_amount: 0 },
    cancelled: { count: 0, total_amount: 0 }
  };

  results.forEach(result => {
    totals[result.status] = {
      count: parseInt(result.count),
      total_amount: parseFloat(result.total_amount) || 0
    };
  });

  return totals;
};

Invoice.getMonthlyRevenue = async function(companyId, year = new Date().getFullYear()) {
  const { Op } = require('sequelize');

  return await this.findAll({
    where: {
      company_id: companyId,
      status: 'paid',
      paid_at: {
        [Op.gte]: new Date(`${year}-01-01`),
        [Op.lt]: new Date(`${year + 1}-01-01`)
      }
    },
    attributes: [
      [sequelize.fn('EXTRACT', sequelize.literal('MONTH FROM paid_at')), 'month'],
      [sequelize.fn('SUM', sequelize.col('total')), 'revenue']
    ],
    group: [sequelize.fn('EXTRACT', sequelize.literal('MONTH FROM paid_at'))],
    order: [[sequelize.fn('EXTRACT', sequelize.literal('MONTH FROM paid_at')), 'ASC']],
    raw: true
  });
};

module.exports = Invoice;
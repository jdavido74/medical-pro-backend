const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Client = sequelize.define('Client', {
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
  type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: {
      isIn: [['company', 'individual']]
    }
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 255]
    }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: true,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: {
      is: /^[\+]?[0-9\s\-\(\)]{8,20}$/
    }
  },
  business_number: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: {
      isBusinessNumber(value) {
        if (value && this.type === 'company') {
          // Validation basique, sera affinée selon le pays de l'entreprise
          if (!/^[A-Z0-9]{8,20}$/.test(value.replace(/\s/g, ''))) {
            throw new Error('Invalid business number format');
          }
        }
      }
    }
  },
  vat_number: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: {
      isVatNumber(value) {
        if (value) {
          // Validation basique format européen
          if (!/^[A-Z]{2}[A-Z0-9]{8,12}$/.test(value.replace(/\s/g, ''))) {
            throw new Error('Invalid VAT number format');
          }
        }
      }
    }
  },
  address: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
    validate: {
      isValidAddress(value) {
        if (value && typeof value === 'object') {
          const allowedFields = ['street', 'city', 'postalCode', 'country', 'state', 'complement'];
          const fields = Object.keys(value);
          const invalidFields = fields.filter(field => !allowedFields.includes(field));
          if (invalidFields.length > 0) {
            throw new Error(`Invalid address fields: ${invalidFields.join(', ')}`);
          }
        }
      }
    }
  },
  billing_settings: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
    validate: {
      isValidBillingSettings(value) {
        if (value && typeof value !== 'object') {
          throw new Error('Billing settings must be a valid JSON object');
        }
      }
    }
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'clients',
  timestamps: true,
  indexes: [
    {
      fields: ['company_id']
    },
    {
      fields: ['type']
    },
    {
      fields: ['is_active']
    },
    {
      fields: ['business_number']
    },
    {
      fields: ['email']
    },
    {
      name: 'clients_company_name_unique',
      unique: true,
      fields: ['company_id', 'name'],
      where: {
        is_active: true
      }
    }
  ],
  hooks: {
    beforeValidate: (client, options) => {
      // Normaliser l'email
      if (client.email) {
        client.email = client.email.toLowerCase().trim();
      }

      // Normaliser le nom
      if (client.name) {
        client.name = client.name.trim();
      }

      // Normaliser les numéros
      if (client.business_number) {
        client.business_number = client.business_number.replace(/\s/g, '').toUpperCase();
      }

      if (client.vat_number) {
        client.vat_number = client.vat_number.replace(/\s/g, '').toUpperCase();
      }
    },
    beforeCreate: (client, options) => {
      // Définir les paramètres de facturation par défaut
      const defaultBillingSettings = {
        paymentTerms: 30, // jours
        currency: 'EUR',
        language: 'fr',
        sendReminders: true,
        autoSend: false
      };

      client.billing_settings = {
        ...defaultBillingSettings,
        ...client.billing_settings
      };
    }
  }
});

// Méthodes d'instance
Client.prototype.toSafeJSON = function() {
  const values = Object.assign({}, this.get());
  return values;
};

Client.prototype.getDisplayName = function() {
  return this.name;
};

Client.prototype.getFullAddress = function() {
  if (!this.address || typeof this.address !== 'object') {
    return '';
  }

  const parts = [];
  if (this.address.street) parts.push(this.address.street);
  if (this.address.complement) parts.push(this.address.complement);
  if (this.address.postalCode && this.address.city) {
    parts.push(`${this.address.postalCode} ${this.address.city}`);
  } else if (this.address.city) {
    parts.push(this.address.city);
  }
  if (this.address.country) parts.push(this.address.country);

  return parts.join('\n');
};

Client.prototype.hasValidBusinessInfo = function() {
  if (this.type === 'individual') {
    return true; // Pas besoin d'infos entreprise pour particulier
  }

  return !!(this.business_number || this.vat_number);
};

Client.prototype.getPaymentTerms = function() {
  return this.billing_settings?.paymentTerms || 30;
};

// Méthodes statiques
Client.findByCompany = async function(companyId, options = {}) {
  return await this.findAll({
    where: {
      company_id: companyId,
      is_active: true,
      ...options.where
    },
    order: [['name', 'ASC']],
    ...options
  });
};

Client.findActiveByCompany = async function(companyId, search = '') {
  const whereClause = {
    company_id: companyId,
    is_active: true
  };

  if (search) {
    const { Op } = require('sequelize');
    whereClause[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } }
    ];
  }

  return await this.findAll({
    where: whereClause,
    order: [['name', 'ASC']],
    limit: 50
  });
};

Client.countByCompany = async function(companyId, type = null) {
  const whereClause = {
    company_id: companyId,
    is_active: true
  };

  if (type) {
    whereClause.type = type;
  }

  return await this.count({ where: whereClause });
};

module.exports = Client;
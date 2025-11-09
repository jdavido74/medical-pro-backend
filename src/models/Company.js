const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Company = sequelize.define('Company', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 255]
    }
  },
  country: {
    type: DataTypes.STRING(2),
    allowNull: false,
    validate: {
      isIn: [['FR', 'ES']]
    }
  },
  business_number: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: {
      isBusinessNumber(value) {
        if (value) {
          if (this.country === 'FR' && !/^\d{14}$/.test(value)) {
            throw new Error('SIRET must be 14 digits for France');
          }
          if (this.country === 'ES' && !/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value)) {
            throw new Error('NIF format invalid for Spain');
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
          if (this.country === 'FR' && !/^FR\d{11}$/.test(value)) {
            throw new Error('French VAT number must start with FR followed by 11 digits');
          }
          if (this.country === 'ES' && !/^ES[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value)) {
            throw new Error('Spanish VAT number must start with ES followed by NIF');
          }
        }
      }
    }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
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
  address: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
    validate: {
      isValidAddress(value) {
        if (value && typeof value === 'object') {
          const requiredFields = ['street', 'city', 'postalCode', 'country'];
          const hasRequired = requiredFields.some(field => value[field]);
          if (Object.keys(value).length > 0 && !hasRequired) {
            throw new Error('Address must contain at least one of: street, city, postalCode, country');
          }
        }
      }
    }
  },
  settings: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
    validate: {
      isValidSettings(value) {
        if (value && typeof value !== 'object') {
          throw new Error('Settings must be a valid JSON object');
        }
      }
    }
  }
}, {
  tableName: 'companies',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['email']
    },
    {
      fields: ['country']
    },
    {
      fields: ['business_number']
    }
  ],
  hooks: {
    beforeValidate: (company, options) => {
      // Normaliser l'email
      if (company.email) {
        company.email = company.email.toLowerCase().trim();
      }

      // Normaliser le numéro d'entreprise
      if (company.business_number) {
        company.business_number = company.business_number.replace(/\s/g, '').toUpperCase();
      }

      // Normaliser le numéro de TVA
      if (company.vat_number) {
        company.vat_number = company.vat_number.replace(/\s/g, '').toUpperCase();
      }
    },
    beforeCreate: (company, options) => {
      // Définir les paramètres par défaut selon le pays
      const defaultSettings = {
        FR: {
          vatLabel: 'TVA',
          defaultVatRate: 20,
          currency: 'EUR',
          dateFormat: 'DD/MM/YYYY',
          numberFormat: 'FR',
          invoicePrefix: 'FA-',
          quotePrefix: 'DV-'
        },
        ES: {
          vatLabel: 'IVA',
          defaultVatRate: 21,
          currency: 'EUR',
          dateFormat: 'DD/MM/YYYY',
          numberFormat: 'ES',
          invoicePrefix: 'FAC-',
          quotePrefix: 'PRES-'
        }
      };

      company.settings = {
        ...defaultSettings[company.country],
        ...company.settings
      };
    }
  }
});

// Méthodes d'instance
Company.prototype.toSafeJSON = function() {
  const values = Object.assign({}, this.get());
  // Masquer les informations sensibles si nécessaire
  return values;
};

Company.prototype.getDisplayName = function() {
  return this.name;
};

Company.prototype.isValidBusinessNumber = function() {
  if (!this.business_number) return false;

  if (this.country === 'FR') {
    return /^\d{14}$/.test(this.business_number);
  }

  if (this.country === 'ES') {
    return /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(this.business_number);
  }

  return false;
};

module.exports = Company;
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
      isIn: [['FR', 'ES', 'GB']]
    }
  },
  locale: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'fr-FR',
    validate: {
      isIn: [['fr-FR', 'es-ES', 'en-GB']]
    },
    comment: 'Full locale code for i18n and regional settings'
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
  description: {
    type: DataTypes.TEXT,
    allowNull: true
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
  db_host: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: 'localhost'
  },
  db_port: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 5432
  },
  db_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  db_user: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: 'medicalpro'
  },
  db_password: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  subdomain: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true
  },
  subscription_status: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'trial'
  },
  subscription_expiry: {
    type: DataTypes.DATEONLY,
    allowNull: true
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
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'Company is active and can be accessed'
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
    comment: 'Soft delete timestamp - NULL means not deleted'
  },
  setup_completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
    comment: 'Timestamp when clinic setup was completed - NULL means setup required for new accounts'
  },
  clinic_db_provisioned: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Whether the clinic database has been provisioned (created + migrations run)'
  },
  clinic_db_provisioned_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
    comment: 'Timestamp when clinic database was provisioned'
  }
}, {
  tableName: 'companies',
  timestamps: true,
  paranoid: false, // We handle soft deletes manually with deleted_at
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
        },
        GB: {
          vatLabel: 'VAT',
          defaultVatRate: 20,
          currency: 'GBP',
          dateFormat: 'DD/MM/YYYY',
          numberFormat: 'GB',
          invoicePrefix: 'INV-',
          quotePrefix: 'QUO-'
        }
      };

      // Dériver le country à partir du locale si non défini
      if (company.locale && !company.country) {
        const localeToCountry = {
          'fr-FR': 'FR',
          'es-ES': 'ES',
          'en-GB': 'GB'
        };
        company.country = localeToCountry[company.locale] || 'FR';
      }

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
  delete values.db_host;
  delete values.db_port;
  delete values.db_name;
  delete values.db_user;
  delete values.db_password;
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

/**
 * Get the setup status for the company
 * @returns {'completed' | 'not_started'} Setup status
 */
Company.prototype.getSetupStatus = function() {
  // If setup_completed_at is set, setup is completed
  if (this.setup_completed_at) {
    return 'completed';
  }

  // For companies created before this feature (no setup_completed_at),
  // we consider them completed to avoid blocking existing users
  // Only new companies (created after feature deployment) need setup
  return 'not_started';
};

/**
 * Mark the company setup as completed
 * @returns {Promise<Company>} Updated company
 */
Company.prototype.completeSetup = async function() {
  this.setup_completed_at = new Date();
  await this.save();
  return this;
};

/**
 * Check if setup is required for this company
 * @returns {boolean} True if setup is required
 */
Company.prototype.isSetupRequired = function() {
  return this.getSetupStatus() !== 'completed';
};

/**
 * Check if clinic database is provisioned
 * @returns {boolean} True if clinic DB is ready
 */
Company.prototype.isClinicDbProvisioned = function() {
  return this.clinic_db_provisioned === true;
};

/**
 * Mark clinic database as provisioned
 * @returns {Promise<Company>} Updated company
 */
Company.prototype.markClinicDbProvisioned = async function() {
  this.clinic_db_provisioned = true;
  this.clinic_db_provisioned_at = new Date();
  await this.save();
  return this;
};

module.exports = Company;
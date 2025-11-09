const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
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
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  first_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
    validate: {
      len: [1, 100]
    }
  },
  last_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
    validate: {
      len: [1, 100]
    }
  },
  role: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'user',
    validate: {
      isIn: [['super_admin', 'admin', 'doctor', 'secretary', 'readonly']]
    }
  },
  permissions: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
    validate: {
      isValidPermissions(value) {
        if (value && typeof value !== 'object') {
          throw new Error('Permissions must be a valid JSON object');
        }
      }
    }
  },
  last_login: {
    type: DataTypes.DATE,
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'users',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['email']
    },
    {
      fields: ['company_id']
    },
    {
      fields: ['role']
    },
    {
      fields: ['is_active']
    }
  ],
  hooks: {
    beforeValidate: (user, options) => {
      // Normaliser l'email
      if (user.email) {
        user.email = user.email.toLowerCase().trim();
      }

      // Capitaliser les noms
      if (user.first_name) {
        user.first_name = user.first_name.trim();
      }
      if (user.last_name) {
        user.last_name = user.last_name.trim();
      }
    },
    beforeCreate: async (user, options) => {
      // Hasher le mot de passe avant création
      if (user.password_hash && !user.password_hash.startsWith('$2a$')) {
        user.password_hash = await bcrypt.hash(user.password_hash, 12);
      }

      // Définir les permissions par défaut selon le rôle
      if (!user.permissions || Object.keys(user.permissions).length === 0) {
        const defaultPermissions = {
          super_admin: {
            // Global admin - all companies
            dashboard: { read: true, write: true },
            clients: { read: true, write: true, delete: true },
            invoices: { read: true, write: true, delete: true },
            quotes: { read: true, write: true, delete: true },
            analytics: { read: true, write: true },
            settings: { read: true, write: true },
            users: { read: true, write: true, delete: true },
            companies: { read: true, write: true, delete: true },
            global_admin: { read: true, write: true, delete: true },
            // Medical
            patients: { read: true, write: true, delete: true },
            practitioners: { read: true, write: true, delete: true },
            appointments: { read: true, write: true, delete: true },
            documents: { read: true, write: true, delete: true },
            consents: { read: true, write: true, delete: true }
          },
          admin: {
            // Clinic admin
            dashboard: { read: true, write: true },
            clients: { read: true, write: true, delete: true },
            invoices: { read: true, write: true, delete: true },
            quotes: { read: true, write: true, delete: true },
            analytics: { read: true, write: true },
            settings: { read: true, write: true },
            users: { read: true, write: true, delete: true },
            // Medical
            patients: { read: true, write: true, delete: true },
            practitioners: { read: true, write: true, delete: true },
            appointments: { read: true, write: true, delete: true },
            documents: { read: true, write: true, delete: true },
            consents: { read: true, write: true, delete: true }
          },
          doctor: {
            // Practitioner - can manage their appointments
            dashboard: { read: true, write: false },
            appointments: { read: true, write: true, delete: false },
            patients: { read: true, write: true, delete: false },
            documents: { read: true, write: true, delete: false },
            consents: { read: true, write: false, delete: false },
            analytics: { read: true, write: false },
            // Cannot access billing or admin
            clients: { read: false, write: false, delete: false },
            invoices: { read: false, write: false, delete: false },
            quotes: { read: false, write: false, delete: false },
            settings: { read: false, write: false },
            users: { read: false, write: false, delete: false }
          },
          secretary: {
            // Administrative staff
            dashboard: { read: true, write: false },
            appointments: { read: true, write: true, delete: true },
            patients: { read: true, write: true, delete: false },
            documents: { read: true, write: true, delete: true },
            consents: { read: true, write: false, delete: false },
            clients: { read: true, write: true, delete: true },
            invoices: { read: true, write: true, delete: true },
            quotes: { read: true, write: true, delete: true },
            analytics: { read: true, write: false },
            // Cannot modify settings or users
            settings: { read: false, write: false },
            users: { read: false, write: false, delete: false }
          },
          readonly: {
            // Read-only access
            dashboard: { read: true, write: false },
            patients: { read: true, write: false, delete: false },
            appointments: { read: true, write: false, delete: false },
            documents: { read: true, write: false, delete: false },
            consents: { read: true, write: false, delete: false },
            clients: { read: true, write: false, delete: false },
            invoices: { read: true, write: false, delete: false },
            quotes: { read: true, write: false, delete: false },
            analytics: { read: true, write: false },
            settings: { read: false, write: false },
            users: { read: false, write: false, delete: false }
          }
        };

        user.permissions = defaultPermissions[user.role] || defaultPermissions.readonly;
      }
    },
    beforeUpdate: async (user, options) => {
      // Hasher le mot de passe avant mise à jour si modifié
      if (user.changed('password_hash') && !user.password_hash.startsWith('$2a$')) {
        user.password_hash = await bcrypt.hash(user.password_hash, 12);
      }
    }
  }
});

// Méthodes d'instance
User.prototype.toSafeJSON = function() {
  const values = Object.assign({}, this.get());
  delete values.password_hash;
  return values;
};

User.prototype.getFullName = function() {
  const parts = [];
  if (this.first_name) parts.push(this.first_name);
  if (this.last_name) parts.push(this.last_name);
  return parts.length > 0 ? parts.join(' ') : this.email;
};

User.prototype.validatePassword = async function(password) {
  if (!password || !this.password_hash) {
    return false;
  }
  return await bcrypt.compare(password, this.password_hash);
};

User.prototype.updateLastLogin = async function() {
  this.last_login = new Date();
  await this.save({ fields: ['last_login'] });
};

User.prototype.hasPermission = function(module, action = 'read') {
  // Vérification permissions granulaires par module
  if (this.permissions && this.permissions[module]) {
    return this.permissions[module][action] === true;
  }

  // Fallback sur la hiérarchie des rôles pour rétrocompatibilité
  const roleHierarchy = {
    readonly: 0,
    user: 1,
    admin: 2
  };

  const userLevel = roleHierarchy[this.role] || 0;
  const requiredLevel = roleHierarchy[module] || 0;

  return userLevel >= requiredLevel;
};

User.prototype.hasModuleAccess = function(module) {
  return this.hasPermission(module, 'read');
};

User.prototype.canModify = function(module) {
  return this.hasPermission(module, 'write');
};

User.prototype.canDelete = function(module) {
  return this.hasPermission(module, 'delete');
};

// Méthodes statiques
User.findByEmail = async function(email) {
  if (!email) return null;
  return await this.findOne({
    where: {
      email: email.toLowerCase().trim(),
      is_active: true
    },
    include: ['company']
  });
};

User.findByCompany = async function(companyId, options = {}) {
  return await this.findAll({
    where: {
      company_id: companyId,
      is_active: true,
      ...options.where
    },
    attributes: { exclude: ['password_hash'] },
    order: [['created_at', 'DESC']],
    ...options
  });
};

User.createWithHashedPassword = async function(userData) {
  const user = await this.create(userData);
  return user.toSafeJSON();
};

module.exports = User;
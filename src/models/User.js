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
    allowNull: true, // Allow NULL for super_admin users who manage all companies
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
    defaultValue: 'admin',
    validate: {
      // Standardized roles: physician, practitioner, secretary, readonly, admin, super_admin
      isIn: [['super_admin', 'admin', 'physician', 'practitioner', 'secretary', 'readonly']]
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
  },
  email_verified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Email verification status'
  },
  email_verification_token: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'JWT token for email verification (expires in 24h)'
  },
  email_verified_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp when email was verified'
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
    },
    {
      fields: ['email_verified']
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

      // NOTE: Les permissions individuelles ne sont plus définies ici.
      // La source de vérité pour les permissions est la table clinic_roles.
      // Les permissions sont chargées depuis clinic_roles au login via getPermissionsFromClinicRoles().
      // user.permissions reste null/vide pour les nouveaux utilisateurs.
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

  // Convert snake_case database field names to camelCase for frontend consistency
  if (values.first_name !== undefined) {
    values.firstName = values.first_name;
    delete values.first_name;
  }
  if (values.last_name !== undefined) {
    values.lastName = values.last_name;
    delete values.last_name;
  }
  if (values.company_id !== undefined) {
    values.companyId = values.company_id;
    delete values.company_id;
  }
  if (values.email_verified !== undefined) {
    values.isEmailVerified = values.email_verified;
    delete values.email_verified;
  }
  if (values.is_active !== undefined) {
    values.isActive = values.is_active;
    delete values.is_active;
  }
  if (values.last_login !== undefined) {
    values.lastLogin = values.last_login;
    delete values.last_login;
  }
  if (values.created_at !== undefined) {
    values.createdAt = values.created_at;
    delete values.created_at;
  }
  if (values.updated_at !== undefined) {
    values.updatedAt = values.updated_at;
    delete values.updated_at;
  }
  if (values.email_verification_token !== undefined) {
    values.emailVerificationToken = values.email_verification_token;
    delete values.email_verification_token;
  }
  if (values.email_verified_at !== undefined) {
    values.emailVerifiedAt = values.email_verified_at;
    delete values.email_verified_at;
  }

  // Add combined name field for frontend display (combines first_name and last_name)
  values.name = this.getFullName();
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
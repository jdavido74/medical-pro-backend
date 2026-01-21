/**
 * Clinic HealthcareProvider Model
 *
 * This table combines user authentication + professional information
 * Unlike central DB where users and practitioners are separate tables
 *
 * Schema matches clinic database structure:
 * - Uses facility_id (not company_id)
 * - Combines authentication (email, password_hash) + professional info
 * - NO soft delete (no deleted_at or archived field)
 * - Role-based permissions
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

/**
 * Create HealthcareProvider model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} HealthcareProvider model configured for the clinic database
 */
function createHealthcareProviderModel(clinicDb) {
  const HealthcareProvider = ClinicBaseModel.create(clinicDb, 'HealthcareProvider', {
    // Facility relationship (NOT company_id!)
    facility_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'medical_facilities',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    // Authentication fields
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true }
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: true // Nullable for invitation-based account creation
    },

    // Personal information
    first_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { len: [1, 100] }
    },
    last_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { len: [1, 100] }
    },
    title: {
      type: DataTypes.STRING(50),
      allowNull: true,
      validate: {
        isIn: [['Dr', 'Pr', 'Mr', 'Mrs', 'Ms']]
      }
    },

    // Professional information
    profession: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    specialties: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
      // Array of strings: ["cardiology", "general_medicine", ...]
    },

    // Professional identifiers (France-specific)
    adeli: {
      type: DataTypes.STRING(11),
      allowNull: true,
      comment: 'Numéro ADELI (9 ou 11 chiffres)'
    },
    rpps: {
      type: DataTypes.STRING(11),
      allowNull: true,
      comment: 'Numéro RPPS (11 chiffres)'
    },
    order_number: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Numéro d\'inscription à l\'ordre professionnel'
    },

    // Role and permissions
    // role = professional role (what they do daily)
    // Standardized roles: physician (doctors), practitioner (other healthcare), secretary, readonly
    role: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'practitioner',
      validate: {
        isIn: [['physician', 'practitioner', 'secretary', 'readonly', 'admin', 'super_admin']]
      }
    },
    // administrative_role = optional cumulative administrative function
    administrative_role: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: null,
      validate: {
        isIn: [['direction', 'clinic_admin', 'hr', 'billing', null]]
      },
      comment: 'Optional administrative role: direction, clinic_admin, hr, billing'
    },
    permissions: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
      // Object with permission flags
    },

    // Contact information
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    mobile: {
      type: DataTypes.STRING(20),
      allowNull: true
    },

    // Availability and scheduling
    availability: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {
        monday: { enabled: true, slots: [] },
        tuesday: { enabled: true, slots: [] },
        wednesday: { enabled: true, slots: [] },
        thursday: { enabled: true, slots: [] },
        friday: { enabled: true, slots: [] },
        saturday: { enabled: false, slots: [] },
        sunday: { enabled: false, slots: [] }
      }
      // Each day: { enabled: boolean, slots: [{ start: "HH:MM", end: "HH:MM" }] }
    },

    // UI display
    color: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: 'blue'
    },

    // Team assignment
    team_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'teams',
        key: 'id'
      },
      onDelete: 'SET NULL'
    },

    // Status fields
    last_login: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
    },
    email_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },

    // Account status and invitation
    account_status: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'active',
      validate: {
        isIn: [['pending', 'active', 'suspended', 'locked']]
      }
    },
    invitation_token: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    invitation_expires_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'healthcare_providers',
    indexes: [
      { fields: ['facility_id'] },
      { fields: ['email'], unique: true },
      { fields: ['role'] },
      { fields: ['is_active'] }
    ]
  });

  // Instance methods
  HealthcareProvider.prototype.getFullName = function() {
    const title = this.title ? `${this.title} ` : '';
    return `${title}${this.first_name} ${this.last_name}`;
  };

  HealthcareProvider.prototype.getProfessionalTitle = function() {
    return `${this.getFullName()} - ${this.profession}`;
  };

  /**
   * Check if provider has a specific permission
   */
  HealthcareProvider.prototype.hasPermission = function(permission) {
    if (this.role === 'super_admin') return true;
    if (!this.permissions) return false;
    return this.permissions[permission] === true;
  };

  /**
   * Check if provider has a specific role
   */
  HealthcareProvider.prototype.hasRole = function(...roles) {
    return roles.includes(this.role);
  };

  /**
   * Update last login timestamp
   */
  HealthcareProvider.prototype.updateLastLogin = async function() {
    this.last_login = new Date();
    return await this.save();
  };

  /**
   * Safe JSON without sensitive data
   */
  HealthcareProvider.prototype.toSafeJSON = function() {
    const values = Object.assign({}, this.get());
    delete values.password_hash;
    return values;
  };

  // Static methods
  /**
   * Find active providers
   */
  HealthcareProvider.findActive = async function(options = {}) {
    return await this.findAll({
      where: {
        is_active: true,
        ...options.where
      },
      ...options
    });
  };

  /**
   * Find by email
   */
  HealthcareProvider.findByEmail = async function(email) {
    return await this.findOne({
      where: { email: email.toLowerCase() }
    });
  };

  /**
   * Find by role
   */
  HealthcareProvider.findByRole = async function(role, options = {}) {
    return await this.findAll({
      where: {
        role,
        is_active: true,
        ...options.where
      },
      ...options
    });
  };

  /**
   * Find practitioners (not admin/support roles)
   */
  HealthcareProvider.findPractitioners = async function(options = {}) {
    const { Op } = require('sequelize');

    return await this.findAll({
      where: {
        role: { [Op.in]: ['practitioner', 'nurse'] },
        is_active: true,
        ...options.where
      },
      ...options
    });
  };

  /**
   * Search providers by name or specialty
   */
  HealthcareProvider.searchProviders = async function(searchTerm, options = {}) {
    const { Op } = require('sequelize');

    return await this.findAll({
      where: {
        is_active: true,
        [Op.or]: [
          { first_name: { [Op.iLike]: `%${searchTerm}%` } },
          { last_name: { [Op.iLike]: `%${searchTerm}%` } },
          { profession: { [Op.iLike]: `%${searchTerm}%` } },
          { email: { [Op.iLike]: `%${searchTerm}%` } }
        ],
        ...options.where
      },
      ...options
    });
  };

  return HealthcareProvider;
}

module.exports = createHealthcareProviderModel;

/**
 * Clinic Patient Model
 *
 * Schema matches clinic database structure:
 * - Uses facility_id (not company_id)
 * - Uses archived boolean (not deleted_at)
 * - Extended medical fields for healthcare compliance
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

/**
 * Create Patient model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} Patient model configured for the clinic database
 */
function createPatientModel(clinicDb) {
  const Patient = ClinicBaseModel.create(clinicDb, 'Patient', {
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

    // Patient identification
    patient_number: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true
    },
    social_security: {
      type: DataTypes.STRING(15),
      allowNull: true
      // Should be encrypted in production
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
    maiden_name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    birth_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,  // Date de naissance optionnelle
      field: 'birth_date'
    },
    gender: {
      type: DataTypes.STRING(10),
      allowNull: true,
      validate: { isIn: [['M', 'F', 'O', 'N/A']] }
    },
    birth_place: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    nationality: {
      type: DataTypes.STRING(50),
      allowNull: true
    },

    // ID document number (DNI, NIE, Passport, etc.)
    id_number: {
      type: DataTypes.STRING(50),
      allowNull: true
    },

    // Address information
    address_line1: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    address_line2: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    postal_code: {
      type: DataTypes.STRING(10),
      allowNull: true
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    country: {
      type: DataTypes.STRING(2),
      allowNull: true,
      defaultValue: 'FR'
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
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: { isEmail: true }
    },

    // Emergency contact
    emergency_contact_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    emergency_contact_phone: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    emergency_contact_relationship: {
      type: DataTypes.STRING(100),
      allowNull: true
    },

    // Medical information
    blood_type: {
      type: DataTypes.STRING(5),
      allowNull: true,
      validate: { isIn: [['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']] }
    },
    allergies: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    chronic_conditions: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    current_medications: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Insurance information
    insurance_provider: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    insurance_number: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    mutual_insurance: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    mutual_number: {
      type: DataTypes.STRING(50),
      allowNull: true
    },

    // Insurance coverage type (Public, Private, Mixed)
    coverage_type: {
      type: DataTypes.STRING(50),
      allowNull: true
    },

    // Preferences and consent
    preferred_language: {
      type: DataTypes.STRING(5),
      allowNull: true,
      defaultValue: 'fr'
    },
    communication_preferences: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    },
    consent_data_processing: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },
    consent_marketing: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },
    legal_representative: {
      type: DataTypes.STRING(255),
      allowNull: true
    },

    // Status fields (NOT deleted_at!)
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
    },
    archived: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    }
  }, {
    tableName: 'patients',
    indexes: [
      { fields: ['facility_id'] },
      { fields: ['patient_number'] },
      { fields: ['social_security'] },
      { fields: ['email'] },
      { fields: ['first_name', 'last_name'] },
      { fields: ['is_active'] },
      { fields: ['archived'] }
    ],
    hooks: {
      beforeCreate: (patient, opts) => {
        // Auto-generate patient_number if not provided
        if (!patient.patient_number) {
          const timestamp = Date.now();
          const random = Math.floor(Math.random() * 1000);
          patient.patient_number = `P${timestamp}${random}`;
        }
      }
    }
  });

  // Instance methods
  Patient.prototype.getFullName = function() {
    return `${this.first_name} ${this.last_name}`;
  };

  Patient.prototype.getAge = function() {
    if (!this.birth_date) return null;
    const today = new Date();
    const birthDate = new Date(this.birth_date);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  /**
   * Soft delete using archived flag (NOT deleted_at!)
   */
  Patient.prototype.archive = async function() {
    this.archived = true;
    this.is_active = false;
    return await this.save();
  };

  /**
   * Restore archived patient
   */
  Patient.prototype.unarchive = async function() {
    this.archived = false;
    this.is_active = true;
    return await this.save();
  };

  /**
   * Check if patient is archived
   */
  Patient.prototype.isArchived = function() {
    return this.archived === true;
  };

  // Static methods
  /**
   * Find active patients (not archived)
   */
  Patient.findActive = async function(options = {}) {
    return await this.findAll({
      where: {
        archived: false,
        is_active: true,
        ...options.where
      },
      ...options
    });
  };

  /**
   * Search patients by name, email, or patient number
   */
  Patient.searchPatients = async function(searchTerm, options = {}) {
    const { Op } = require('sequelize');

    return await this.findAll({
      where: {
        archived: false,
        [Op.or]: [
          { first_name: { [Op.iLike]: `%${searchTerm}%` } },
          { last_name: { [Op.iLike]: `%${searchTerm}%` } },
          { email: { [Op.iLike]: `%${searchTerm}%` } },
          { patient_number: { [Op.iLike]: `%${searchTerm}%` } }
        ],
        ...options.where
      },
      ...options
    });
  };

  return Patient;
}

module.exports = createPatientModel;

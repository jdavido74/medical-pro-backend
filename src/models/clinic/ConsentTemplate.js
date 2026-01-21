/**
 * Clinic Consent Template Model
 *
 * Schema for consent template management:
 * - Versioned consent templates
 * - Multi-type support (medical, data processing, etc.)
 * - Validity period management
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

/**
 * Create ConsentTemplate model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} ConsentTemplate model configured for the clinic database
 */
function createConsentTemplateModel(clinicDb) {
  const ConsentTemplate = ClinicBaseModel.create(clinicDb, 'ConsentTemplate', {
    // Company relationship (required by DB schema)
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'companies',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    // Template identification
    code: {
      type: DataTypes.STRING(100),
      allowNull: false
      // Unique per company, handled by index
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Template content
    terms: {
      type: DataTypes.TEXT,
      allowNull: false
    },

    // Versioning
    version: {
      type: DataTypes.STRING(20),
      defaultValue: '1.0'
    },

    // Type and configuration
    consent_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [[
          'medical_treatment',    // Traitement médical général / soins médicaux
          'surgery',              // Chirurgie / interventions chirurgicales
          'anesthesia',           // Anesthésie
          'diagnostic',           // Examens et diagnostics
          'telehealth',           // Télémédecine / consultations à distance
          'clinical_trial',       // Essai clinique / recherche
          'minor_treatment',      // Traitement de mineur
          'data_processing',      // RGPD / Protection des données
          'photo',                // Droit à l'image
          'communication',        // Communication commerciale
          'dental',               // Soins dentaires
          'mental_health',        // Santé mentale
          'prevention',           // Prévention / vaccinations
          'general_care'          // Soins généraux (alias backward compat)
        ]]
      }
    },
    is_mandatory: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    auto_send: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    // Validity period
    valid_from: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    valid_until: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },

    // Default language for this template
    default_language: {
      type: DataTypes.STRING(5),
      defaultValue: 'fr',
      validate: {
        isIn: [['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ar', 'zh', 'ja', 'ko', 'ru']]
      }
    },

    // Template status (lifecycle)
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: 'draft',
      validate: {
        isIn: [['draft', 'active', 'inactive']]
      }
    },

    // Metadata for frontend-specific data (speciality, variables, tags)
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
      // { speciality, variables: [], tags: [], requiredFields: [] }
    },

    // Soft delete
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'consent_templates',
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
      { fields: ['company_id'] },
      { fields: ['consent_type'] },
      { fields: ['valid_from', 'valid_until'] }
    ]
  });

  // Instance methods
  /**
   * Check if template is currently valid
   */
  ConsentTemplate.prototype.isValid = function() {
    const now = new Date();
    const validFrom = this.valid_from ? new Date(this.valid_from) : null;
    const validUntil = this.valid_until ? new Date(this.valid_until) : null;

    if (validFrom && now < validFrom) return false;
    if (validUntil && now > validUntil) return false;
    return !this.deleted_at;
  };

  /**
   * Increment version
   */
  ConsentTemplate.prototype.incrementVersion = async function() {
    const parts = this.version.split('.');
    const minor = parseInt(parts[1] || '0', 10) + 1;
    this.version = `${parts[0]}.${minor}`;
    return await this.save();
  };

  // Static methods
  /**
   * Find active templates
   */
  ConsentTemplate.findActive = async function(options = {}) {
    const now = new Date();
    const { Op } = require('sequelize');

    return await this.findAll({
      where: {
        deleted_at: null,
        valid_from: { [Op.lte]: now },
        [Op.or]: [
          { valid_until: null },
          { valid_until: { [Op.gte]: now } }
        ],
        ...options.where
      },
      order: [['title', 'ASC']],
      ...options
    });
  };

  /**
   * Find templates by type
   */
  ConsentTemplate.findByType = async function(consentType, options = {}) {
    return await this.findAll({
      where: {
        consent_type: consentType,
        deleted_at: null,
        ...options.where
      },
      order: [['title', 'ASC']],
      ...options
    });
  };

  /**
   * Find mandatory templates
   */
  ConsentTemplate.findMandatory = async function(options = {}) {
    return await this.findAll({
      where: {
        is_mandatory: true,
        deleted_at: null,
        ...options.where
      },
      order: [['title', 'ASC']],
      ...options
    });
  };

  return ConsentTemplate;
}

module.exports = createConsentTemplateModel;

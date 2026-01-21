/**
 * Clinic Consent Model
 *
 * Schema for clinic-specific consent management:
 * - GDPR-compliant electronic signature tracking
 * - Patient consent for medical treatments and data processing
 * - Audit trail for compliance
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

/**
 * Create Consent model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} Consent model configured for the clinic database
 */
function createConsentModel(clinicDb) {
  const Consent = ClinicBaseModel.create(clinicDb, 'Consent', {
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

    // Patient relationship
    patient_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'patients',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    // Optional relationships
    appointment_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'appointments',
        key: 'id'
      }
    },
    product_service_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    consent_template_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'consent_templates',
        key: 'id'
      }
    },

    // Consent type and content
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
    title: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    terms: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    purpose: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Configuration
    is_required: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },

    // Expiration
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true
    },

    // Witness (for verbal consents)
    witness: {
      type: DataTypes.JSONB,
      allowNull: true
      // { name, role, signature }
    },

    // Specific details (for medical-specific consents)
    specific_details: {
      type: DataTypes.JSONB,
      allowNull: true
      // { procedure, risks, alternatives, expected_results }
    },

    // Status and signature
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'accepted', 'rejected']]
      }
    },
    signed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    signature_method: {
      type: DataTypes.STRING(20),
      allowNull: true,
      validate: {
        isIn: [['digital', 'checkbox', 'pin', 'verbal', 'written']]
      }
    },

    // GDPR audit fields
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    device_info: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },

    // Document reference
    related_document_id: {
      type: DataTypes.UUID,
      allowNull: true
    },

    // Language used for this consent (for multilingual support)
    language_code: {
      type: DataTypes.STRING(5),
      defaultValue: 'fr',
      validate: {
        isIn: [['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ar', 'zh', 'ja', 'ko', 'ru']]
      }
    },

    // Template version at time of signature (for historization)
    template_version: {
      type: DataTypes.STRING(20),
      allowNull: true
    },

    // Signature image (base64 encoded canvas image)
    signature_image: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Revocation
    revocation_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Created by (practitioner who created the consent)
    created_by: {
      type: DataTypes.UUID,
      allowNull: true
    },

    // Link to signing request if created via signing workflow
    signing_request_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'consent_signing_requests',
        key: 'id'
      }
    },

    // Soft delete
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'consents',
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
      { fields: ['company_id'] },
      { fields: ['patient_id'] },
      { fields: ['status'] },
      { fields: ['consent_type'] },
      { fields: ['patient_id', 'status'] },
      { fields: ['appointment_id'] },
      { fields: ['consent_template_id'] }
    ]
  });

  // Instance methods
  /**
   * Sign the consent with GDPR-compliant tracking
   */
  Consent.prototype.sign = async function(signatureMethod, ipAddress, deviceInfo = {}) {
    this.status = 'accepted';
    this.signed_at = new Date();
    this.signature_method = signatureMethod;
    this.ip_address = ipAddress;
    this.device_info = deviceInfo;
    return await this.save();
  };

  /**
   * Revoke consent
   */
  Consent.prototype.revoke = async function(reason = 'patient_request') {
    this.status = 'rejected';
    this.device_info = {
      ...this.device_info,
      revocation_reason: reason,
      revoked_at: new Date().toISOString()
    };
    return await this.save();
  };

  // Static methods
  /**
   * Find consents by patient
   */
  Consent.findByPatient = async function(patientId, options = {}) {
    return await this.findAll({
      where: {
        patient_id: patientId,
        deleted_at: null,
        ...options.where
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  /**
   * Find active (accepted) consents by patient
   */
  Consent.findActiveByPatient = async function(patientId, options = {}) {
    return await this.findAll({
      where: {
        patient_id: patientId,
        status: 'accepted',
        deleted_at: null,
        ...options.where
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  /**
   * Check if patient has valid consent for a type
   */
  Consent.hasValidConsent = async function(patientId, consentType) {
    const consent = await this.findOne({
      where: {
        patient_id: patientId,
        consent_type: consentType,
        status: 'accepted',
        deleted_at: null
      }
    });
    return !!consent;
  };

  return Consent;
}

module.exports = createConsentModel;

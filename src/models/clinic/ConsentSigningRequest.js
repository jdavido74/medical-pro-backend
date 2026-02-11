/**
 * Clinic Consent Signing Request Model
 *
 * Schema for managing consent signature requests:
 * - Email/SMS/tablet-based signing workflows
 * - Secure token-based public access
 * - GDPR-compliant tracking
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes, Op } = require('sequelize');
const crypto = require('crypto');

/**
 * Create ConsentSigningRequest model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} ConsentSigningRequest model configured for the clinic database
 */
function createConsentSigningRequestModel(clinicDb) {
  const ConsentSigningRequest = ClinicBaseModel.create(clinicDb, 'ConsentSigningRequest', {
    // Company reference (stores central DB company ID without FK constraint)
    // Note: No foreign key since companies table is in central DB, not clinic DB
    company_id: {
      type: DataTypes.UUID,
      allowNull: false
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

    // Template relationship
    consent_template_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'consent_templates',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    // Optional appointment relationship
    appointment_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'appointments',
        key: 'id'
      },
      onDelete: 'SET NULL'
    },

    // Secure token for public access
    signing_token: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      defaultValue: DataTypes.UUIDV4
    },

    // Token expiration
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false
    },

    // Request status
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'signed', 'expired', 'cancelled']]
      }
    },

    // Link to signed consent after completion
    signed_consent_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'consents',
        key: 'id'
      },
      onDelete: 'SET NULL'
    },
    signed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },

    // Delivery method
    sent_via: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'email',
      validate: {
        isIn: [['email', 'sms', 'tablet', 'link']]
      }
    },

    // Contact information
    recipient_email: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    recipient_phone: {
      type: DataTypes.STRING(50),
      allowNull: true
    },

    // Language
    language_code: {
      type: DataTypes.STRING(5),
      defaultValue: 'fr'
    },

    // Custom message
    custom_message: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Tracking timestamps
    sent_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    viewed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    reminder_sent_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    reminder_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },

    // GDPR audit trail
    ip_address_sent: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    ip_address_signed: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    device_info_signed: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },

    // Practitioner who created the request
    practitioner_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      },
      onDelete: 'SET NULL'
    },

    // Filled content (variables substituted with real patient data)
    filled_title: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    filled_description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    filled_terms: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Creator
    created_by: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    tableName: 'consent_signing_requests',
    indexes: [
      { fields: ['company_id'] },
      { fields: ['patient_id'] },
      { fields: ['signing_token'], unique: true },
      { fields: ['status'] },
      { fields: ['expires_at'] },
      { fields: ['appointment_id'] },
      { fields: ['practitioner_id'] }
    ]
  });

  // Instance methods

  /**
   * Check if request is still valid (not expired and pending)
   */
  ConsentSigningRequest.prototype.isValid = function() {
    return this.status === 'pending' && new Date() < new Date(this.expires_at);
  };

  /**
   * Mark as viewed (first access to signing page)
   */
  ConsentSigningRequest.prototype.markViewed = async function(ipAddress) {
    if (!this.viewed_at) {
      this.viewed_at = new Date();
      await this.save();
    }
    return this;
  };

  /**
   * Complete the signing process
   */
  ConsentSigningRequest.prototype.complete = async function(consentId, ipAddress, deviceInfo = {}) {
    this.status = 'signed';
    this.signed_at = new Date();
    this.signed_consent_id = consentId;
    this.ip_address_signed = ipAddress;
    this.device_info_signed = deviceInfo;
    return await this.save();
  };

  /**
   * Cancel the request
   */
  ConsentSigningRequest.prototype.cancel = async function() {
    this.status = 'cancelled';
    return await this.save();
  };

  /**
   * Send reminder
   */
  ConsentSigningRequest.prototype.sendReminder = async function() {
    this.reminder_count += 1;
    this.reminder_sent_at = new Date();
    return await this.save();
  };

  // Static methods

  /**
   * Find by secure token (for public access)
   */
  ConsentSigningRequest.findByToken = async function(token) {
    return await this.findOne({
      where: {
        signing_token: token
      }
    });
  };

  /**
   * Find valid request by token (not expired, pending)
   */
  ConsentSigningRequest.findValidByToken = async function(token) {
    return await this.findOne({
      where: {
        signing_token: token,
        status: 'pending',
        expires_at: {
          [Op.gt]: new Date()
        }
      }
    });
  };

  /**
   * Find requests for a patient
   */
  ConsentSigningRequest.findByPatient = async function(patientId, options = {}) {
    return await this.findAll({
      where: {
        patient_id: patientId,
        ...options.where
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  /**
   * Find pending requests for appointment
   */
  ConsentSigningRequest.findPendingByAppointment = async function(appointmentId) {
    return await this.findAll({
      where: {
        appointment_id: appointmentId,
        status: 'pending',
        expires_at: {
          [Op.gt]: new Date()
        }
      }
    });
  };

  /**
   * Expire old pending requests (for cron job)
   */
  ConsentSigningRequest.expireOldRequests = async function() {
    const [count] = await this.update(
      { status: 'expired' },
      {
        where: {
          status: 'pending',
          expires_at: {
            [Op.lt]: new Date()
          }
        }
      }
    );
    return count;
  };

  /**
   * Generate a short unique code for tablet display (6 chars)
   */
  ConsentSigningRequest.generateShortCode = function() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  };

  return ConsentSigningRequest;
}

module.exports = createConsentSigningRequestModel;

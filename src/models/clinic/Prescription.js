/**
 * Clinic Prescription Model
 *
 * Ordonnances médicales - Traçabilité et conformité
 * Conformité: RGPD, Art. L1110-4 du Code de la santé publique
 *
 * Features:
 * - Auto-generated prescription numbers (ORD-YYYY-MM-NNNN)
 * - Patient and provider snapshots for historical accuracy
 * - Print tracking and access logging
 * - Finalization workflow
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes, Op } = require('sequelize');

/**
 * Create Prescription model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} Prescription model configured for the clinic database
 */
function createPrescriptionModel(clinicDb) {
  const Prescription = ClinicBaseModel.create(clinicDb, 'Prescription', {
    // Relationships
    facility_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'medical_facilities',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    patient_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'patients',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    provider_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    medical_record_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'medical_records',
        key: 'id'
      },
      onDelete: 'SET NULL'
    },

    // Prescription number (auto-generated: ORD-YYYY-MM-NNNN)
    prescription_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },

    // Medications/Treatments (JSONB array)
    medications: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
      // Array of: { medication, dosage, frequency, route, duration, quantity, instructions }
    },

    // Instructions for pharmacist/patient
    instructions: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Additional notes from doctor
    additional_notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Dates
    prescribed_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    valid_until: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },

    // Renewable
    renewable: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    renewals_remaining: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },

    // Snapshots for historical accuracy
    patient_snapshot: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // { firstName, lastName, birthDate, gender, address, phone, email, patientNumber }
    },
    provider_snapshot: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // { firstName, lastName, specialty, rpps, adeli, signature, clinic_info }
    },
    vital_signs: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // { weight, height, bmi, bloodPressure, heartRate, temperature }
    },
    diagnosis: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // { primary, secondary[], icd10[] }
    },
    // Clinical context snapshots for prescription printing
    basic_info: {
      type: DataTypes.JSONB,
      defaultValue: null,
      allowNull: true
    },
    current_illness: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    antecedents: {
      type: DataTypes.JSONB,
      defaultValue: null,
      allowNull: true
    },
    physical_exam: {
      type: DataTypes.JSONB,
      defaultValue: null,
      allowNull: true
    },
    current_medications: {
      type: DataTypes.JSONB,
      defaultValue: null,
      allowNull: true
    },

    // Status workflow
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'draft',
      validate: {
        isIn: [['draft', 'active', 'finalized', 'printed', 'dispensed', 'expired', 'cancelled']]
      }
    },

    // Finalization
    finalized_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    finalized_by: {
      type: DataTypes.UUID,
      allowNull: true
    },

    // Print tracking
    print_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    last_printed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },

    // RGPD compliance
    access_log: {
      type: DataTypes.JSONB,
      defaultValue: []
    }
  }, {
    tableName: 'prescriptions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['facility_id'] },
      { fields: ['patient_id'] },
      { fields: ['provider_id'] },
      { fields: ['medical_record_id'] },
      { fields: ['prescription_number'], unique: true },
      { fields: ['status'] },
      { fields: ['prescribed_date'] }
    ]
  });

  // Instance methods

  /**
   * Log access to this prescription (RGPD compliance)
   */
  Prescription.prototype.logAccess = async function(action, userId, ipAddress, details = {}) {
    const accessEntry = {
      action,
      userId,
      timestamp: new Date().toISOString(),
      ipAddress,
      ...details
    };

    const currentLog = this.access_log || [];
    this.access_log = [...currentLog, accessEntry];
    await this.save();
  };

  /**
   * Finalize prescription (locks it for editing)
   */
  Prescription.prototype.finalize = async function(userId) {
    if (this.status === 'finalized' || this.status === 'printed') {
      throw new Error('Cette ordonnance est déjà finalisée');
    }

    this.status = 'finalized';
    this.finalized_at = new Date();
    this.finalized_by = userId;
    await this.save();
    return this;
  };

  /**
   * Mark as printed
   */
  Prescription.prototype.markPrinted = async function() {
    this.print_count = (this.print_count || 0) + 1;
    this.last_printed_at = new Date();
    if (this.status === 'finalized') {
      this.status = 'printed';
    }
    await this.save();
    return this;
  };

  /**
   * Check if prescription can be modified
   */
  Prescription.prototype.canBeModified = function() {
    return this.status === 'draft';
  };

  // Class methods

  /**
   * Get prescriptions for a patient
   */
  Prescription.getByPatient = async function(patientId, options = {}) {
    const where = { patient_id: patientId };

    if (options.status) {
      where.status = options.status;
    }

    return this.findAll({
      where,
      order: [['prescribed_date', 'DESC'], ['created_at', 'DESC']],
      limit: options.limit || 50
    });
  };

  /**
   * Get prescriptions for a medical record
   */
  Prescription.getByMedicalRecord = async function(medicalRecordId) {
    return this.findAll({
      where: { medical_record_id: medicalRecordId },
      order: [['created_at', 'DESC']]
    });
  };

  /**
   * Generate prescription number
   */
  Prescription.generatePrescriptionNumber = async function() {
    const now = new Date();
    const yearStr = now.getFullYear().toString();
    const monthStr = (now.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `ORD-${yearStr}-${monthStr}-`;

    // Get the highest existing number for this month
    const lastPrescription = await this.findOne({
      where: {
        prescription_number: {
          [Op.like]: `${prefix}%`
        }
      },
      order: [['prescription_number', 'DESC']]
    });

    let seqNum = 1;
    if (lastPrescription) {
      const match = lastPrescription.prescription_number.match(/ORD-\d{4}-\d{2}-(\d+)/);
      if (match) {
        seqNum = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}${seqNum.toString().padStart(4, '0')}`;
  };

  return Prescription;
}

module.exports = createPrescriptionModel;

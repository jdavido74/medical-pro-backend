/**
 * Clinic MedicalRecord Model
 *
 * Dossiers médicaux des patients - Données protégées par le secret médical
 * Conformité: RGPD, Art. L1110-4 du Code de la santé publique
 *
 * Schema matches clinic database structure:
 * - Uses facility_id (not company_id)
 * - Uses archived boolean (not deleted_at)
 * - Full audit trail for RGPD compliance
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

/**
 * Create MedicalRecord model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} MedicalRecord model configured for the clinic database
 */
function createMedicalRecordModel(clinicDb) {
  const MedicalRecord = ClinicBaseModel.create(clinicDb, 'MedicalRecord', {
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
      allowNull: true,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      },
      onDelete: 'SET NULL'
    },

    // Date et heure de consultation (éditable, par défaut = date/heure de création)
    record_date: {
      type: DataTypes.DATE, // TIMESTAMP WITH TIME ZONE
      allowNull: true,
      comment: 'Date et heure de consultation (éditable) - Peut différer de created_at'
    },

    // Assistant optionnel (infirmière, aide-soignant, etc.)
    assistant_provider_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      },
      onDelete: 'SET NULL',
      comment: 'Assistant ayant participé à la consultation (infirmier(e), aide-soignant(e), etc.)'
    },

    // Record number (auto-generated if not provided)
    record_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },

    // Consultation date (required by database schema)
    consultation_date: {
      type: DataTypes.DATE,
      allowNull: false
    },

    // Record type
    record_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'consultation',
      validate: {
        isIn: [['consultation', 'examination', 'treatment', 'follow_up', 'emergency', 'prescription', 'lab_result', 'imaging', 'note']]
      }
    },

    // Basic consultation info
    chief_complaint: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    current_illness: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    symptoms: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
      // Array of strings
    },
    duration: {
      type: DataTypes.STRING(100),
      allowNull: true
    },

    // Vital signs
    vital_signs: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
      // { weight, height, bmi, bloodPressure: {systolic, diastolic}, heartRate, temperature, respiratoryRate, oxygenSaturation }
    },

    // Medical history (antecedents)
    antecedents: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
      // { personal: {medicalHistory, surgicalHistory, allergies, habits}, family: {...} }
    },

    // Allergies detailed
    allergies: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
      // [{ allergen, type, severity, reaction, dateDiscovered }]
    },

    // Diagnosis
    diagnosis: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
      // { primary, secondary: [], icd10: [] }
    },

    // Chronic conditions
    chronic_conditions: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
      // [{ condition, diagnosisDate, practitioner, status, notes }]
    },

    // Physical examination
    physical_exam: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
      // { general, cardiovascular, respiratory, abdomen, neurological }
    },

    // Treatments/Medications
    treatments: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
      // [{ medication, dosage, frequency, route, startDate, endDate, status, prescribedBy, notes }]
    },

    // Treatment plan
    treatment_plan: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
      // { recommendations: [], followUp, tests: [] }
    },

    // Current medications (patient's existing medications, separate from treatments)
    current_medications: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
      // [{ medication, dosage, frequency, start_date, prescribed_by, notes }]
    },

    // Medication warnings (interactions)
    medication_warnings: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
      // [{ type, severity, medications, warning, recommendation }]
    },

    // Blood type
    blood_type: {
      type: DataTypes.STRING(5),
      allowNull: true,
      validate: {
        isIn: [['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']]
      }
    },

    // Notes
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    private_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes visibles uniquement par le praticien créateur'
    },

    // Access control and audit (RGPD compliance)
    access_log: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
      // [{ action, userId, timestamp, ipAddress, details }]
    },

    // Signature status
    is_signed: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },
    signed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    signed_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      }
    },
    is_locked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: 'Verrouillage après signature - Empêche les modifications'
    },

    // Soft delete
    archived: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },
    archived_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    archived_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      }
    },

    // Created by
    created_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      }
    }
  }, {
    tableName: 'medical_records',
    indexes: [
      { fields: ['facility_id'] },
      { fields: ['patient_id'] },
      { fields: ['provider_id'] },
      { fields: ['assistant_provider_id'] },
      { fields: ['record_type'] },
      { fields: ['record_date'] },
      { fields: ['created_at'] },
      { fields: ['archived'] },
      { fields: ['patient_id', 'created_at'] },
      { fields: ['record_number'], unique: true }
    ],
    hooks: {
      beforeValidate: (record, opts) => {
        // Auto-generate record_number before validation if not provided
        if (!record.record_number) {
          const timestamp = Date.now();
          const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
          record.record_number = `MR${timestamp}${random}`;
        }
        // Auto-set consultation_date before validation if not provided
        if (!record.consultation_date) {
          record.consultation_date = new Date();
        }
        // Auto-set record_date from consultation_date if not provided
        if (!record.record_date) {
          record.record_date = record.consultation_date || new Date();
        }
      }
    }
  });

  // Instance methods
  /**
   * Log access to this record (RGPD compliance)
   */
  MedicalRecord.prototype.logAccess = async function(action, userId, ipAddress = 'unknown', details = {}) {
    const accessLog = this.access_log || [];
    accessLog.push({
      action,
      userId,
      timestamp: new Date().toISOString(),
      ipAddress,
      details
    });
    this.access_log = accessLog;
    return await this.save();
  };

  /**
   * Sign the record (locks it for modifications)
   */
  MedicalRecord.prototype.sign = async function(providerId) {
    if (this.is_signed) {
      throw new Error('Ce dossier est déjà signé');
    }
    this.is_signed = true;
    this.signed_at = new Date();
    this.signed_by = providerId;
    this.is_locked = true;
    return await this.save();
  };

  /**
   * Archive the record
   */
  MedicalRecord.prototype.archive = async function(providerId) {
    this.archived = true;
    this.archived_at = new Date();
    this.archived_by = providerId;
    return await this.save();
  };

  /**
   * Restore archived record
   */
  MedicalRecord.prototype.unarchive = async function() {
    this.archived = false;
    this.archived_at = null;
    this.archived_by = null;
    return await this.save();
  };

  /**
   * Check if record can be modified
   */
  MedicalRecord.prototype.canBeModified = function() {
    return !this.is_locked && !this.archived;
  };

  /**
   * Get display title
   */
  MedicalRecord.prototype.getDisplayTitle = function() {
    const typeLabels = {
      consultation: 'Consultation',
      examination: 'Examen',
      treatment: 'Traitement',
      follow_up: 'Suivi',
      emergency: 'Urgence',
      prescription: 'Ordonnance',
      lab_result: 'Résultat labo',
      imaging: 'Imagerie',
      note: 'Note'
    };
    const date = new Date(this.created_at).toLocaleDateString('fr-FR');
    return `${typeLabels[this.record_type] || this.record_type} - ${date}`;
  };

  // Static methods
  /**
   * Find by patient (most common query)
   */
  MedicalRecord.findByPatient = async function(patientId, options = {}) {
    return await this.findAll({
      where: {
        patient_id: patientId,
        archived: false,
        ...options.where
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  /**
   * Find by provider
   */
  MedicalRecord.findByProvider = async function(providerId, options = {}) {
    return await this.findAll({
      where: {
        provider_id: providerId,
        archived: false,
        ...options.where
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  /**
   * Find by type
   */
  MedicalRecord.findByType = async function(recordType, options = {}) {
    return await this.findAll({
      where: {
        record_type: recordType,
        archived: false,
        ...options.where
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  /**
   * Get patient medical history with statistics
   */
  MedicalRecord.getPatientHistory = async function(patientId, options = {}) {
    const records = await this.findByPatient(patientId, options);

    // Group by type
    const byType = {};
    records.forEach(record => {
      const type = record.record_type;
      if (!byType[type]) byType[type] = [];
      byType[type].push(record);
    });

    // Get active treatments
    const activeTreatments = [];
    records.forEach(record => {
      if (record.treatments && Array.isArray(record.treatments)) {
        record.treatments.forEach(t => {
          if (t.status === 'active') {
            activeTreatments.push({ ...t, recordId: record.id, recordDate: record.created_at });
          }
        });
      }
    });

    // Get all allergies
    const allergies = [];
    records.forEach(record => {
      if (record.allergies && Array.isArray(record.allergies)) {
        record.allergies.forEach(a => {
          if (!allergies.find(existing => existing.allergen === a.allergen)) {
            allergies.push(a);
          }
        });
      }
    });

    return {
      records,
      byType,
      statistics: {
        total: records.length,
        byType: Object.keys(byType).reduce((acc, type) => {
          acc[type] = byType[type].length;
          return acc;
        }, {}),
        activeTreatments: activeTreatments.length,
        allergiesCount: allergies.length
      },
      activeTreatments,
      allergies
    };
  };

  /**
   * Check medication interactions
   */
  MedicalRecord.checkMedicationInteractions = function(treatments) {
    const KNOWN_INTERACTIONS = {
      'warfarina': ['aspirina', 'ibuprofeno', 'diclofenaco'],
      'aspirina': ['warfarina', 'metotrexato'],
      'metformina': ['alcohol'],
      'lisinopril': ['ibuprofeno', 'potasio']
    };

    const warnings = [];
    const activeMeds = (treatments || []).filter(t => t.status === 'active');

    for (let i = 0; i < activeMeds.length; i++) {
      for (let j = i + 1; j < activeMeds.length; j++) {
        const med1 = activeMeds[i].medication?.toLowerCase();
        const med2 = activeMeds[j].medication?.toLowerCase();

        if (med1 && med2) {
          if (KNOWN_INTERACTIONS[med1]?.includes(med2)) {
            warnings.push({
              type: 'interaction',
              severity: 'high',
              medications: [activeMeds[i].medication, activeMeds[j].medication],
              warning: `Interaction détectée entre ${activeMeds[i].medication} et ${activeMeds[j].medication}`,
              recommendation: 'Consulter le médecin'
            });
          }
          if (KNOWN_INTERACTIONS[med2]?.includes(med1)) {
            warnings.push({
              type: 'interaction',
              severity: 'high',
              medications: [activeMeds[j].medication, activeMeds[i].medication],
              warning: `Interaction détectée entre ${activeMeds[j].medication} et ${activeMeds[i].medication}`,
              recommendation: 'Consulter le médecin'
            });
          }
        }
      }
    }

    return warnings;
  };

  return MedicalRecord;
}

module.exports = createMedicalRecordModel;

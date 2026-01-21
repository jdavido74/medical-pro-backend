/**
 * Clinic Appointment Model
 *
 * Schema matches clinic database structure:
 * - Uses facility_id (not company_id)
 * - Uses provider_id → healthcare_providers (not practitioner_id → practitioners)
 * - NO soft delete (no deleted_at or archived field)
 * - Separate date and time fields (appointment_date + start_time/end_time)
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

/**
 * Create Appointment model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} Appointment model configured for the clinic database
 */
function createAppointmentModel(clinicDb) {
  const Appointment = ClinicBaseModel.create(clinicDb, 'Appointment', {
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

    // Provider relationship (NOT practitioner_id!)
    provider_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'healthcare_providers', // NOT practitioners!
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    // Appointment identification
    appointment_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },

    // Date and time (separate fields, not combined timestamp)
    appointment_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    start_time: {
      type: DataTypes.TIME,
      allowNull: false
    },
    end_time: {
      type: DataTypes.TIME,
      allowNull: false
    },
    duration_minutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30
    },

    // Appointment details
    // Types aligned with frontend: consultation, followup, emergency, specialist, checkup, vaccination, surgery, procedure, teleconsultation
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['consultation', 'followup', 'emergency', 'checkup', 'procedure', 'teleconsultation', 'specialist', 'vaccination', 'surgery']]
      }
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    // Priority
    priority: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: 'normal',
      validate: {
        isIn: [['low', 'normal', 'high', 'urgent']]
      }
    },

    // Location
    location: {
      type: DataTypes.STRING(255),
      allowNull: true
    },

    // Status
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'scheduled',
      validate: {
        isIn: [['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']]
      }
    },

    // Reminders configuration
    reminders: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {
        patient: { enabled: true, beforeMinutes: 1440 },
        practitioner: { enabled: true, beforeMinutes: 30 }
      }
    },
    reminder_sent: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },
    reminder_sent_at: {
      type: DataTypes.DATE,
      allowNull: true
    },

    // Confirmation
    confirmation_required: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
    },
    confirmed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    confirmed_by: {
      type: DataTypes.STRING(50),
      allowNull: true
    },

    // Teleconsultation
    is_teleconsultation: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },
    meeting_link: {
      type: DataTypes.STRING(255),
      allowNull: true
    },

    // Billing
    consultation_fee: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    insurance_covered: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
    }
  }, {
    tableName: 'appointments',
    indexes: [
      { fields: ['facility_id', 'appointment_date'] },
      { fields: ['patient_id'] },
      { fields: ['provider_id', 'appointment_date'] },
      { fields: ['start_time'] },
      { fields: ['status'] },
      { fields: ['appointment_number'], unique: true },
      // Unique constraint: provider + date + time
      {
        fields: ['provider_id', 'appointment_date', 'start_time'],
        unique: true,
        name: 'appointments_provider_id_appointment_date_start_time_key'
      }
    ],
    hooks: {
      beforeValidate: (appointment, opts) => {
        // Auto-generate appointment_number if not provided (must be in beforeValidate, not beforeCreate)
        if (!appointment.appointment_number) {
          const timestamp = Date.now();
          const random = Math.floor(Math.random() * 1000);
          appointment.appointment_number = `A${timestamp}${random}`;
        }

        // Validate end_time is after start_time
        if (appointment.start_time && appointment.end_time) {
          const start = new Date(`1970-01-01T${appointment.start_time}`);
          const end = new Date(`1970-01-01T${appointment.end_time}`);
          if (end <= start) {
            throw new Error('End time must be after start time');
          }
        }
      }
    }
  });

  // Instance methods
  Appointment.prototype.getDateTime = function() {
    return `${this.appointment_date} ${this.start_time}`;
  };

  Appointment.prototype.getDuration = function() {
    if (this.duration_minutes) return this.duration_minutes;

    // Calculate from start/end time if not set
    if (this.start_time && this.end_time) {
      const start = new Date(`1970-01-01T${this.start_time}`);
      const end = new Date(`1970-01-01T${this.end_time}`);
      return Math.round((end - start) / (1000 * 60));
    }

    return null;
  };

  Appointment.prototype.cancel = async function(reason) {
    this.status = 'cancelled';
    if (reason) {
      this.notes = (this.notes || '') + `\nCancelled: ${reason}`;
    }
    return await this.save();
  };

  Appointment.prototype.confirm = async function(confirmedBy) {
    this.status = 'confirmed';
    this.confirmed_at = new Date();
    this.confirmed_by = confirmedBy;
    return await this.save();
  };

  Appointment.prototype.complete = async function() {
    this.status = 'completed';
    return await this.save();
  };

  Appointment.prototype.markNoShow = async function() {
    this.status = 'no_show';
    return await this.save();
  };

  // Static methods
  /**
   * Find appointments for a specific date
   */
  Appointment.findByDate = async function(date, options = {}) {
    return await this.findAll({
      where: {
        appointment_date: date,
        ...options.where
      },
      order: [['start_time', 'ASC']],
      ...options
    });
  };

  /**
   * Find appointments for a provider on a specific date
   */
  Appointment.findByProviderAndDate = async function(providerId, date, options = {}) {
    return await this.findAll({
      where: {
        provider_id: providerId,
        appointment_date: date,
        ...options.where
      },
      order: [['start_time', 'ASC']],
      ...options
    });
  };

  /**
   * Find appointments for a patient
   */
  Appointment.findByPatient = async function(patientId, options = {}) {
    return await this.findAll({
      where: {
        patient_id: patientId,
        ...options.where
      },
      order: [['appointment_date', 'DESC'], ['start_time', 'DESC']],
      ...options
    });
  };

  /**
   * Check for time conflicts
   */
  Appointment.checkConflict = async function(providerId, date, startTime, endTime, excludeId = null) {
    const { Op } = require('sequelize');

    const where = {
      provider_id: providerId,
      appointment_date: date,
      status: { [Op.ne]: 'cancelled' },
      [Op.or]: [
        // New appointment starts during existing appointment
        {
          start_time: { [Op.lte]: startTime },
          end_time: { [Op.gt]: startTime }
        },
        // New appointment ends during existing appointment
        {
          start_time: { [Op.lt]: endTime },
          end_time: { [Op.gte]: endTime }
        },
        // New appointment completely contains existing appointment
        {
          start_time: { [Op.gte]: startTime },
          end_time: { [Op.lte]: endTime }
        }
      ]
    };

    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }

    const conflict = await this.findOne({ where });
    return conflict !== null;
  };

  /**
   * Find upcoming appointments
   */
  Appointment.findUpcoming = async function(options = {}) {
    const { Op } = require('sequelize');
    const today = new Date().toISOString().split('T')[0];

    return await this.findAll({
      where: {
        appointment_date: { [Op.gte]: today },
        status: { [Op.in]: ['scheduled', 'confirmed'] },
        ...options.where
      },
      order: [['appointment_date', 'ASC'], ['start_time', 'ASC']],
      ...options
    });
  };

  return Appointment;
}

module.exports = createAppointmentModel;

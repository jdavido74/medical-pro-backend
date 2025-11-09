/**
 * Patient Model
 * Medical record with GDPR compliance (soft delete, encryption-ready)
 */

const BaseModel = require('../base/BaseModel');
const { DataTypes } = require('sequelize');

const Patient = BaseModel.create('Patient', {
  first_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: { len: [2, 100] }
  },
  last_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: { len: [2, 100] }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: true,
    validate: { isEmail: true }
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: { is: /^[\+]?[0-9\s\-\(\)]{8,20}$/ }
  },
  date_of_birth: {
    type: DataTypes.DATE,
    allowNull: true
  },
  gender: {
    type: DataTypes.STRING(10),
    allowNull: true,
    validate: { isIn: [['M', 'F', 'O', 'N/A']] }
  },
  social_security_number: {
    type: DataTypes.STRING(255),
    allowNull: true
    // Will be encrypted in application layer
  },
  patient_number: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  medical_history: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  address: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  emergency_contact: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  insurance_info: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  is_incomplete: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'active',
    validate: { isIn: [['active', 'inactive', 'archived']] }
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'patients',
  indexes: [
    {
      name: 'patients_company_patient_number_unique',
      unique: true,
      fields: ['company_id', 'patient_number'],
      where: { deleted_at: null }
    }
  ],
  hooks: {
    beforeCreate: (patient, opts) => {
      // Auto-generate patient_number if not provided
      if (!patient.patient_number) {
        patient.patient_number = `P-${Date.now()}`;
      }
    }
  }
});

// Instance methods
Patient.prototype.getFullName = function() {
  return `${this.first_name} ${this.last_name}`;
};

Patient.prototype.getAge = function() {
  if (!this.date_of_birth) return null;
  const today = new Date();
  let age = today.getFullYear() - this.date_of_birth.getFullYear();
  const monthDiff = today.getMonth() - this.date_of_birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < this.date_of_birth.getDate())) {
    age--;
  }
  return age;
};

module.exports = Patient;

const BaseModel = require('../base/BaseModel');
const { DataTypes } = require('sequelize');

const Appointment = BaseModel.create('Appointment', {
  patient_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'patients', key: 'id' }
  },
  practitioner_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'practitioners', key: 'id' }
  },
  start_time: {
    type: DataTypes.DATE,
    allowNull: false
  },
  end_time: {
    type: DataTypes.DATE,
    allowNull: false,
    validate: {
      isAfterStart(value) {
        if (value <= this.start_time) {
          throw new Error('End time must be after start time');
        }
      }
    }
  },
  reason: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  notes: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'scheduled',
    validate: { isIn: [['scheduled', 'confirmed', 'cancelled', 'completed', 'no-show']] }
  }
}, {
  tableName: 'appointments',
  indexes: [
    { fields: ['patient_id'] },
    { fields: ['practitioner_id'] },
    { fields: ['start_time'] },
    { fields: ['company_id', 'start_time', 'end_time'] }
  ]
});

module.exports = Appointment;

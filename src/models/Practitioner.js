const BaseModel = require('../base/BaseModel');
const { DataTypes } = require('sequelize');

const Practitioner = BaseModel.create('Practitioner', {
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  license_number: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  license_expiry: {
    type: DataTypes.DATE,
    allowNull: true
  },
  speciality: {
    type: DataTypes.JSONB,
    defaultValue: [],
    // Array: ["dentiste", "kiné", "chirurgien", ...]
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  photo_url: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  working_hours: {
    type: DataTypes.JSONB,
    defaultValue: {},
    // { "monday": { "start": "09:00", "end": "18:00" }, ... }
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'practitioners',
  indexes: [
    {
      name: 'practitioners_company_license_unique',
      unique: true,
      fields: ['company_id', 'license_number'],
      where: { deleted_at: null }
    }
  ]
});

module.exports = Practitioner;

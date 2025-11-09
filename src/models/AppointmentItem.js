const BaseModel = require('../base/BaseModel');
const { DataTypes } = require('sequelize');

const AppointmentItem = BaseModel.create('AppointmentItem', {
  appointment_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'appointments', key: 'id' }
  },
  product_service_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'product_services', key: 'id' }
  },
  quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'proposed',
    validate: { isIn: [['proposed', 'accepted', 'refused', 'completed']] }
  },
  notes: { type: DataTypes.TEXT, allowNull: true }
}, { tableName: 'appointment_items', indexes: [{ fields: ['appointment_id'] }, { fields: ['product_service_id'] }, { fields: ['status'] }] });

module.exports = AppointmentItem;

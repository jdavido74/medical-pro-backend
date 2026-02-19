/**
 * Clinic AppointmentItem Model
 *
 * Items/services added to an appointment (treatments, products, etc.)
 * Used for syncing treatments between appointments and medical records.
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

/**
 * Create AppointmentItem model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} AppointmentItem model configured for the clinic database
 */
function createAppointmentItemModel(clinicDb) {
  const AppointmentItem = ClinicBaseModel.create(clinicDb, 'AppointmentItem', {
    appointment_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'appointments',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    product_service_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products_services',
        key: 'id'
      }
    },
    quantity: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 1
    },
    unit_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'proposed',
      validate: {
        isIn: [['proposed', 'accepted', 'refused', 'completed']]
      }
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'appointment_items',
    indexes: [
      { fields: ['appointment_id'] },
      { fields: ['product_service_id'] },
      { fields: ['status'] }
    ]
  });

  return AppointmentItem;
}

module.exports = createAppointmentItemModel;

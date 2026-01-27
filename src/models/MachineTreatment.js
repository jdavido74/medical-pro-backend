const { DataTypes } = require('sequelize');

/**
 * MachineTreatment model factory
 * Junction table for Machine ↔ ProductService (Treatment) many-to-many relationship
 * @param {Sequelize} sequelize - Clinic database Sequelize instance
 */
module.exports = (sequelize) => {
  const MachineTreatment = sequelize.define('MachineTreatment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    machine_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'machines',
        key: 'id'
      }
    },
    treatment_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products_services',
        key: 'id'
      }
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    }
  }, {
    tableName: 'machine_treatments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    underscored: true,
    indexes: [
      {
        fields: ['machine_id', 'treatment_id'],
        unique: true
      }
    ]
  });

  return MachineTreatment;
};

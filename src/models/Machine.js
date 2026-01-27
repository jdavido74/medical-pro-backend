const { DataTypes } = require('sequelize');

/**
 * Machine model factory
 * Physical machines/resources that can be booked for treatments
 * @param {Sequelize} sequelize - Clinic database Sequelize instance
 */
module.exports = (sequelize) => {
  const Machine = sequelize.define('Machine', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 100]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    color: {
      type: DataTypes.STRING(7),
      allowNull: true,
      defaultValue: '#3B82F6',
      validate: {
        is: /^#[0-9A-Fa-f]{6}$/
      }
    },
    location: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    }
  }, {
    tableName: 'machines',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        fields: ['company_id']
      },
      {
        fields: ['is_active']
      }
    ]
  });

  // Associations are handled by ModelFactory.setupAssociations()
  // Machine ↔ ProductService (many-to-many through machine_treatments)

  return Machine;
};

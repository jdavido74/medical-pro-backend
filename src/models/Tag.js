const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Tag = sequelize.define('Tag', {
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
    color: {
      type: DataTypes.STRING(7),
      allowNull: true,
      defaultValue: '#6366F1',
      validate: {
        is: /^#[0-9A-Fa-f]{6}$/
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: true,
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
    tableName: 'tags',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        fields: ['company_id']
      },
      {
        fields: ['name', 'company_id'],
        unique: true
      }
    ]
  });

  Tag.associate = (models) => {
    Tag.belongsToMany(models.ProductService, {
      through: 'product_tags',
      foreignKey: 'tag_id',
      otherKey: 'product_service_id',
      as: 'products'
    });
  };

  return Tag;
};

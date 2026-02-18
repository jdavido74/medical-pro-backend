/**
 * UserClinicMembership Model
 * Tracks which users belong to which clinics (multi-clinic support)
 * Located in central database
 */

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class UserClinicMembership extends Model {
    /**
     * Find all clinics for a given email
     * @param {string} email - User email
     * @returns {Promise<Array>} List of clinic memberships
     */
    static async findClinicsByEmail(email) {
      return this.findAll({
        where: {
          email: email.toLowerCase(),
          is_active: true
        },
        include: [{
          model: sequelize.models.Company,
          as: 'company',
          attributes: ['id', 'name', 'country', 'locale']
        }],
        order: [['is_primary', 'DESC'], ['created_at', 'ASC']]
      });
    }

    /**
     * Find membership for specific email and company
     * @param {string} email - User email
     * @param {string} companyId - Company ID
     * @returns {Promise<UserClinicMembership|null>}
     */
    static async findMembership(email, companyId) {
      return this.findOne({
        where: {
          email: email.toLowerCase(),
          company_id: companyId,
          is_active: true
        },
        include: [{
          model: sequelize.models.Company,
          as: 'company'
        }]
      });
    }

    /**
     * Create or update membership
     * @param {Object} data - Membership data
     * @returns {Promise<UserClinicMembership>}
     */
    static async upsertMembership(data) {
      const [membership, created] = await this.upsert({
        email: data.email.toLowerCase(),
        company_id: data.companyId,
        provider_id: data.providerId,
        role_in_clinic: data.roleInClinic || 'user',
        is_primary: data.isPrimary || false,
        display_name: data.displayName,
        is_active: data.isActive !== false
      }, {
        conflictFields: ['email', 'company_id']
      });
      return membership;
    }
  }

  UserClinicMembership.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        isEmail: true
      },
      set(value) {
        this.setDataValue('email', value ? value.toLowerCase() : value);
      }
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'companies',
        key: 'id'
      }
    },
    provider_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID in healthcare_providers table (or users table for admins)'
    },
    role_in_clinic: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'practitioner',
      validate: {
        // Standardized roles
        isIn: [['super_admin', 'admin', 'physician', 'practitioner', 'nurse', 'secretary', 'readonly']]
      }
    },
    is_primary: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Default clinic when user has multiple memberships'
    },
    display_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'UserClinicMembership',
    tableName: 'user_clinic_memberships',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['email'] },
      { fields: ['company_id'] },
      { fields: ['email', 'is_active'] },
      { unique: true, fields: ['email', 'company_id'] }
    ]
  });

  return UserClinicMembership;
};

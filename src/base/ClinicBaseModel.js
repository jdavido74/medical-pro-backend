/**
 * ClinicBaseModel - Base model for clinic-specific databases
 *
 * Key Differences from BaseModel:
 * - NO company_id field (clinics are isolated by database)
 * - NO deleted_at field (clinic tables use different soft delete mechanisms)
 * - Uses facility_id for relationships
 * - Provides clinic-appropriate query methods
 *
 * Architecture:
 * - Central DB: company metadata, subscriptions, user authentication
 * - Clinic DBs: ALL operational data (patients, appointments, providers, etc.)
 * - Multi-tenancy through database-level isolation
 *
 * Usage:
 * const ClinicBaseModel = require('./ClinicBaseModel');
 * const Patient = ClinicBaseModel.create(clinicDb, 'Patient', {
 *   first_name: { type: DataTypes.STRING(100), allowNull: false },
 *   // ... other fields
 * });
 */

const { DataTypes } = require('sequelize');

class ClinicBaseModel {
  /**
   * Create a clinic-specific model
   * @param {Sequelize} clinicDb - Clinic database Sequelize instance
   * @param {string} modelName - Model name (e.g., 'Patient')
   * @param {Object} attributes - Model attributes
   * @param {Object} options - Sequelize options
   * @returns {Model} Configured Sequelize model for clinic database
   */
  static create(clinicDb, modelName, attributes, options = {}) {
    if (!clinicDb) {
      throw new Error('clinicDb is required for ClinicBaseModel');
    }

    // Standard fields for clinic models
    // Note: NO company_id (isolation by database), NO deleted_at (varies by model)
    const fullAttributes = {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      ...attributes
    };

    // Standard options for clinic models
    const fullOptions = {
      tableName: options.tableName || modelName.toLowerCase() + 's',
      timestamps: true,
      paranoid: false, // No automatic soft delete
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      ...options,

      // Standardized hooks
      hooks: {
        beforeValidate: (instance, opts) => {
          this.normalizeInstance(instance);
          if (options.hooks?.beforeValidate) {
            options.hooks.beforeValidate(instance, opts);
          }
        },

        beforeCreate: (instance, opts) => {
          this.setDefaults(instance);
          if (options.hooks?.beforeCreate) {
            options.hooks.beforeCreate(instance, opts);
          }
        },

        beforeUpdate: (instance, opts) => {
          if (options.hooks?.beforeUpdate) {
            options.hooks.beforeUpdate(instance, opts);
          }
        }
      },

      sequelize: clinicDb
    };

    const model = clinicDb.define(modelName, fullAttributes, fullOptions);

    // Add instance methods
    this.addInstanceMethods(model);

    // Add static methods (clinic-specific, no company_id queries)
    this.addStaticMethods(model);

    return model;
  }

  /**
   * Add instance methods
   */
  static addInstanceMethods(model) {
    /**
     * Return safe JSON (without sensitive data)
     */
    model.prototype.toSafeJSON = function() {
      const values = Object.assign({}, this.get());
      // Never return sensitive data
      delete values.password_hash;
      delete values.social_security;
      delete values.social_security_number;
      return values;
    };

    /**
     * Get display name
     */
    model.prototype.getDisplayName = function() {
      if (this.first_name && this.last_name) {
        return `${this.first_name} ${this.last_name}`;
      }
      if (this.name) {
        return this.name;
      }
      if (this.email) {
        return this.email;
      }
      return `${model.name} #${this.id.substring(0, 8)}`;
    };
  }

  /**
   * Add static methods (clinic-specific)
   */
  static addStaticMethods(model) {
    /**
     * Find by facility (clinic-specific equivalent of findByCompany)
     */
    model.findByFacility = async function(facilityId, options = {}) {
      return await this.findAll({
        where: {
          facility_id: facilityId,
          ...options.where
        },
        ...options
      });
    };

    /**
     * Find active by ID
     * Note: Different models may have different active flags (is_active, archived, etc.)
     */
    model.findActiveById = async function(id, whereClause = {}) {
      return await this.findOne({
        where: {
          id,
          ...whereClause
        }
      });
    };

    /**
     * Count records
     */
    model.countRecords = async function(whereClause = {}) {
      return await this.count({
        where: whereClause
      });
    };

    /**
     * Find with pagination
     */
    model.findWithPagination = async function(whereClause, options = {}) {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;

      const { count, rows } = await this.findAndCountAll({
        where: whereClause,
        limit,
        offset,
        order: options.order || [['created_at', 'DESC']],
        ...options
      });

      const totalPages = Math.ceil(count / limit);

      return {
        data: rows,
        pagination: {
          current: page,
          total: totalPages,
          count,
          limit,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    };

    /**
     * Multi-field search
     */
    model.search = async function(searchQuery, searchFields, options = {}) {
      const { Op } = require('sequelize');

      const where = {};

      if (searchQuery && searchFields.length > 0) {
        where[Op.or] = searchFields.map(field => ({
          [field]: { [Op.iLike]: `%${searchQuery}%` }
        }));
      }

      return await this.findWithPagination(where, options);
    };
  }

  /**
   * Normalize instance data
   */
  static normalizeInstance(instance) {
    // Trim strings
    Object.keys(instance.dataValues).forEach(key => {
      if (typeof instance[key] === 'string') {
        instance[key] = instance[key].trim();
      }

      // Lowercase emails
      if (key === 'email' && instance[key]) {
        instance[key] = instance[key].toLowerCase().trim();
      }
    });
  }

  /**
   * Set defaults (can be overridden by child models)
   */
  static setDefaults(instance) {
    // To be overridden by child models if needed
  }
}

module.exports = ClinicBaseModel;

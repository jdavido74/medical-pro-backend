/**
 * BaseModel - Classe abstraite pour tous les modèles Sequelize
 * Fournit patterns standards pour:
 * - Hooks (validation, normalisation, defaults)
 * - Méthodes utilitaires (toSafeJSON, getDisplayName, softDelete)
 * - Méthodes de recherche multi-tenant (findByCompany, findActive, search)
 *
 * Usage:
 * const BaseModel = require('./BaseModel');
 * class Patient extends BaseModel {
 *   static getAttributes() { return { ... } }
 *   static getOptions() { return { ... } }
 * }
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

class BaseModel {
  /**
   * Créer un modèle hérité de BaseModel
   * @param {string} modelName - Nom du modèle (ex: 'Patient')
   * @param {Object} attributes - Attributs du modèle
   * @param {Object} options - Options Sequelize
   * @returns {Object} Modèle Sequelize configuré
   */
  static create(modelName, attributes, options = {}) {
    // Ajouter les champs standards si pas présents
    const fullAttributes = {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      company_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'companies',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
      },
      ...attributes
    };

    // Options standards
    const fullOptions = {
      tableName: options.tableName || modelName.toLowerCase() + 's',
      timestamps: true,
      paranoid: false, // On gère soft delete manuellement avec deleted_at
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      ...options,

      // Hooks standardisés
      hooks: {
        // Normaliser les données avant validation
        beforeValidate: (instance, opts) => {
          this.normalizeInstance(instance);
          if (options.hooks?.beforeValidate) {
            options.hooks.beforeValidate(instance, opts);
          }
        },

        // Définir les defaults avant création
        beforeCreate: (instance, opts) => {
          this.setDefaults(instance);
          if (options.hooks?.beforeCreate) {
            options.hooks.beforeCreate(instance, opts);
          }
        },

        // Logger avant update
        beforeUpdate: (instance, opts) => {
          if (options.hooks?.beforeUpdate) {
            options.hooks.beforeUpdate(instance, opts);
          }
        }
      },

      // Indexes standards
      indexes: [
        {
          fields: ['company_id']
        },
        {
          fields: ['deleted_at']
        },
        ...(options.indexes || [])
      ]
    };

    const model = sequelize.define(modelName, fullAttributes, fullOptions);

    // Ajouter méthodes d'instance standards
    this.addInstanceMethods(model);

    // Ajouter méthodes statiques standards
    this.addStaticMethods(model);

    return model;
  }

  /**
   * Ajouter méthodes d'instance
   */
  static addInstanceMethods(model) {
    /**
     * Retourner une version sécurisée (sans données sensibles)
     */
    model.prototype.toSafeJSON = function() {
      const values = Object.assign({}, this.get());
      // Ne jamais retourner les données sensibles
      delete values.password_hash;
      delete values.ssn; // social security number
      delete values.medical_number;
      return values;
    };

    /**
     * Obtenir le nom d'affichage
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

    /**
     * Soft delete
     */
    model.prototype.softDelete = async function() {
      this.deleted_at = new Date();
      return await this.save();
    };

    /**
     * Restaurer (undo soft delete)
     */
    model.prototype.restore = async function() {
      this.deleted_at = null;
      return await this.save();
    };

    /**
     * Vérifier si soft deleted
     */
    model.prototype.isDeleted = function() {
      return this.deleted_at !== null;
    };
  }

  /**
   * Ajouter méthodes statiques
   */
  static addStaticMethods(model) {
    /**
     * Trouver tous les enregistrements actifs d'une clinique
     */
    model.findByCompany = async function(companyId, options = {}) {
      return await this.findAll({
        where: {
          company_id: companyId,
          deleted_at: null,
          ...options.where
        },
        ...options
      });
    };

    /**
     * Trouver un enregistrement actif par ID et company_id
     */
    model.findActiveById = async function(id, companyId) {
      return await this.findOne({
        where: {
          id,
          company_id: companyId,
          deleted_at: null
        }
      });
    };

    /**
     * Compter les enregistrements actifs d'une clinique
     */
    model.countByCompany = async function(companyId, whereClause = {}) {
      return await this.count({
        where: {
          company_id: companyId,
          deleted_at: null,
          ...whereClause
        }
      });
    };

    /**
     * Rechercher avec pagination
     */
    model.findWithPagination = async function(whereClause, options = {}) {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;

      const { count, rows } = await this.findAndCountAll({
        where: {
          deleted_at: null,
          ...whereClause
        },
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
     * Recherche multi-champ
     */
    model.searchByCompany = async function(companyId, searchQuery, searchFields, options = {}) {
      const { Op } = require('sequelize');

      const where = {
        company_id: companyId,
        deleted_at: null
      };

      if (searchQuery && searchFields.length > 0) {
        where[Op.or] = searchFields.map(field => ({
          [field]: { [Op.iLike]: `%${searchQuery}%` }
        }));
      }

      return await this.findWithPagination(where, options);
    };
  }

  /**
   * Normaliser les données
   */
  static normalizeInstance(instance) {
    // Trimmer les strings
    Object.keys(instance.dataValues).forEach(key => {
      if (typeof instance[key] === 'string') {
        instance[key] = instance[key].trim();
      }

      // Lowercaser les emails
      if (key === 'email' && instance[key]) {
        instance[key] = instance[key].toLowerCase().trim();
      }
    });
  }

  /**
   * Définir les defaults
   */
  static setDefaults(instance) {
    // À surcharger par les classes enfants
  }
}

module.exports = BaseModel;

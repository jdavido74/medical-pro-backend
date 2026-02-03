/**
 * Clinic SystemCategory Model
 *
 * Dynamic system categories with multilingual support:
 * - consent_type: Types of consent (medical_treatment, surgery, etc.)
 * - appointment_type: Types of appointments (consultation, followup, etc.)
 * - specialty: Medical specialties (cardiology, dermatology, etc.)
 * - department: Organization departments (administration, nursing, etc.)
 * - priority: Priority levels (low, normal, high, urgent)
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes, Op } = require('sequelize');

/**
 * Valid category types
 */
const CATEGORY_TYPES = [
  'consent_type',
  'appointment_type',
  'specialty',
  'department',
  'priority'
];

/**
 * Create SystemCategory model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} SystemCategory model configured for the clinic database
 */
function createSystemCategoryModel(clinicDb) {
  const SystemCategory = ClinicBaseModel.create(clinicDb, 'SystemCategory', {
    // Unique identifier within category_type (e.g., 'medical_treatment', 'cardiology')
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 50],
        is: /^[a-z][a-z0-9_]*$/i // alphanumeric with underscores, starts with letter
      }
    },

    // System category type
    category_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [CATEGORY_TYPES]
      }
    },

    // Multilingual translations
    // Structure: { "es": { "name": "...", "description": "..." }, "fr": {...}, "en": {...} }
    translations: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    },

    // Type-specific metadata
    // For consent_type: { required, renewable, defaultDuration, icon, color }
    // For appointment_type: { duration, color, priority }
    // For specialty: { icon, color, modules }
    // For department: { icon, color }
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    },

    // Display order
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },

    // Whether this category is active
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },

    // System categories cannot be deleted
    is_system: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  }, {
    tableName: 'system_categories',
    indexes: [
      { fields: ['category_type'] },
      { fields: ['code'] },
      { fields: ['is_active'] },
      { fields: ['category_type', 'code'], unique: true }
    ]
  });

  // ============================================================================
  // STATIC METHODS
  // ============================================================================

  /**
   * Get all categories by type
   * @param {string} type - Category type (e.g., 'consent_type')
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of categories
   */
  SystemCategory.findByType = async function(type, options = {}) {
    const { includeInactive = false, ...queryOptions } = options;

    const where = {
      category_type: type
    };

    if (!includeInactive) {
      where.is_active = true;
    }

    return await this.findAll({
      where,
      order: [['sort_order', 'ASC'], ['code', 'ASC']],
      ...queryOptions
    });
  };

  /**
   * Get a single category by type and code
   * @param {string} type - Category type
   * @param {string} code - Category code
   * @returns {Promise<Object|null>} Category or null
   */
  SystemCategory.findByTypeAndCode = async function(type, code) {
    return await this.findOne({
      where: {
        category_type: type,
        code: code
      }
    });
  };

  /**
   * Get all active categories grouped by type
   * @returns {Promise<Object>} Categories grouped by type
   */
  SystemCategory.findAllGroupedByType = async function() {
    const categories = await this.findAll({
      where: { is_active: true },
      order: [['category_type', 'ASC'], ['sort_order', 'ASC'], ['code', 'ASC']]
    });

    const grouped = {};
    for (const category of categories) {
      const type = category.category_type;
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(category);
    }

    return grouped;
  };

  /**
   * Get available category types
   * @returns {string[]} List of category types
   */
  SystemCategory.getAvailableTypes = function() {
    return [...CATEGORY_TYPES];
  };

  /**
   * Validate that a code exists for a given type
   * @param {string} type - Category type
   * @param {string} code - Category code
   * @returns {Promise<boolean>} Whether the code is valid
   */
  SystemCategory.isValidCode = async function(type, code) {
    const count = await this.count({
      where: {
        category_type: type,
        code: code,
        is_active: true
      }
    });
    return count > 0;
  };

  /**
   * Bulk reorder categories within a type
   * @param {string} type - Category type
   * @param {string[]} orderedIds - Array of category IDs in desired order
   * @returns {Promise<number>} Number of updated records
   */
  SystemCategory.reorder = async function(type, orderedIds) {
    const transaction = await clinicDb.transaction();

    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await this.update(
          { sort_order: i },
          {
            where: {
              id: orderedIds[i],
              category_type: type
            },
            transaction
          }
        );
      }

      await transaction.commit();
      return orderedIds.length;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  };

  /**
   * Get codes for a type (useful for validation)
   * @param {string} type - Category type
   * @param {boolean} activeOnly - Only active categories
   * @returns {Promise<string[]>} Array of codes
   */
  SystemCategory.getCodesByType = async function(type, activeOnly = true) {
    const where = { category_type: type };
    if (activeOnly) {
      where.is_active = true;
    }

    const categories = await this.findAll({
      where,
      attributes: ['code'],
      order: [['sort_order', 'ASC']]
    });

    return categories.map(c => c.code);
  };

  /**
   * Search categories by name (across translations)
   * @param {string} query - Search query
   * @param {string} type - Optional category type filter
   * @returns {Promise<Array>} Matching categories
   */
  SystemCategory.searchByName = async function(query, type = null) {
    const searchPattern = `%${query.toLowerCase()}%`;

    const where = {
      is_active: true,
      [Op.or]: [
        clinicDb.literal(`translations->'es'->>'name' ILIKE '${searchPattern}'`),
        clinicDb.literal(`translations->'en'->>'name' ILIKE '${searchPattern}'`),
        clinicDb.literal(`translations->'fr'->>'name' ILIKE '${searchPattern}'`)
      ]
    };

    if (type) {
      where.category_type = type;
    }

    return await this.findAll({
      where,
      order: [['sort_order', 'ASC']]
    });
  };

  // ============================================================================
  // INSTANCE METHODS
  // ============================================================================

  /**
   * Get translated name for a language
   * @param {string} lang - Language code (es, en, fr)
   * @returns {string} Translated name or code as fallback
   */
  SystemCategory.prototype.getTranslatedName = function(lang = 'es') {
    const translations = this.translations || {};
    return translations[lang]?.name
      || translations.es?.name
      || translations.en?.name
      || this.code;
  };

  /**
   * Get translated description for a language
   * @param {string} lang - Language code (es, en, fr)
   * @returns {string} Translated description or empty string
   */
  SystemCategory.prototype.getTranslatedDescription = function(lang = 'es') {
    const translations = this.translations || {};
    return translations[lang]?.description
      || translations.es?.description
      || translations.en?.description
      || '';
  };

  /**
   * Get metadata value
   * @param {string} key - Metadata key
   * @param {*} defaultValue - Default value if key not found
   * @returns {*} Metadata value or default
   */
  SystemCategory.prototype.getMetadata = function(key, defaultValue = null) {
    const metadata = this.metadata || {};
    return metadata[key] !== undefined ? metadata[key] : defaultValue;
  };

  /**
   * Check if category can be deleted
   * @returns {boolean} Whether deletion is allowed
   */
  SystemCategory.prototype.canDelete = function() {
    return !this.is_system;
  };

  /**
   * Transform for API response
   * @param {string} lang - Language for translations
   * @returns {Object} Transformed object
   */
  SystemCategory.prototype.toApiResponse = function(lang = 'es') {
    return {
      id: this.id,
      code: this.code,
      categoryType: this.category_type,
      name: this.getTranslatedName(lang),
      description: this.getTranslatedDescription(lang),
      translations: this.translations,
      metadata: this.metadata,
      sortOrder: this.sort_order,
      isActive: this.is_active,
      isSystem: this.is_system,
      createdAt: this.created_at,
      updatedAt: this.updated_at
    };
  };

  return SystemCategory;
}

module.exports = createSystemCategoryModel;

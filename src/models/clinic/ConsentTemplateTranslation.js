/**
 * Clinic Consent Template Translation Model
 *
 * Schema for multilingual consent template support:
 * - Stores translations for each consent template
 * - Supports multiple languages per template
 * - Tracks who created the translation
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

/**
 * Create ConsentTemplateTranslation model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} ConsentTemplateTranslation model configured for the clinic database
 */
function createConsentTemplateTranslationModel(clinicDb) {
  const ConsentTemplateTranslation = ClinicBaseModel.create(clinicDb, 'ConsentTemplateTranslation', {
    // Parent template reference
    consent_template_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'consent_templates',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    // Language code (ISO 639-1)
    language_code: {
      type: DataTypes.STRING(5),
      allowNull: false,
      validate: {
        isIn: [['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ar', 'zh', 'ja', 'ko', 'ru']]
      }
    },

    // Translated content
    title: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    terms: {
      type: DataTypes.TEXT,
      allowNull: false
    },

    // Audit - who translated
    translated_by: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    tableName: 'consent_template_translations',
    indexes: [
      { fields: ['consent_template_id'] },
      { fields: ['language_code'] },
      {
        fields: ['consent_template_id', 'language_code'],
        unique: true,
        name: 'uk_template_language'
      }
    ]
  });

  // Static methods
  /**
   * Find all translations for a template
   */
  ConsentTemplateTranslation.findByTemplate = async function(templateId, options = {}) {
    return await this.findAll({
      where: {
        consent_template_id: templateId,
        ...options.where
      },
      order: [['language_code', 'ASC']],
      ...options
    });
  };

  /**
   * Find translation for a specific language
   */
  ConsentTemplateTranslation.findByLanguage = async function(templateId, languageCode, options = {}) {
    return await this.findOne({
      where: {
        consent_template_id: templateId,
        language_code: languageCode,
        ...options.where
      },
      ...options
    });
  };

  /**
   * Get available languages for a template
   */
  ConsentTemplateTranslation.getAvailableLanguages = async function(templateId) {
    const translations = await this.findAll({
      where: { consent_template_id: templateId },
      attributes: ['language_code'],
      raw: true
    });
    return translations.map(t => t.language_code);
  };

  /**
   * Upsert translation (create or update)
   */
  ConsentTemplateTranslation.upsertTranslation = async function(templateId, languageCode, data, userId = null) {
    const existing = await this.findByLanguage(templateId, languageCode);

    if (existing) {
      return await existing.update({
        title: data.title,
        description: data.description,
        terms: data.terms,
        translated_by: userId
      });
    } else {
      return await this.create({
        consent_template_id: templateId,
        language_code: languageCode,
        title: data.title,
        description: data.description,
        terms: data.terms,
        translated_by: userId
      });
    }
  };

  return ConsentTemplateTranslation;
}

module.exports = createConsentTemplateTranslationModel;

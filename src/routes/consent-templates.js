/**
 * Consent Templates Routes - Clinic Isolated
 * CRUD operations for consent templates with multilingual support
 * (clinic-specific database isolation)
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const { getModel } = require('../base/ModelFactory');
const { logger } = require('../utils/logger');
const { PERMISSIONS } = require('../utils/permissionConstants');

const router = express.Router();

// Supported languages
const SUPPORTED_LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ar', 'zh', 'ja', 'ko', 'ru'];

// Valid consent types - unified across backend and frontend
const CONSENT_TYPES = [
  'medical_treatment',  // Traitement médical général / soins médicaux
  'surgery',            // Chirurgie / interventions chirurgicales
  'anesthesia',         // Anesthésie
  'diagnostic',         // Examens et diagnostics
  'telehealth',         // Télémédecine / consultations à distance
  'clinical_trial',     // Essai clinique / recherche
  'minor_treatment',    // Traitement de mineur
  'data_processing',    // RGPD / Protection des données
  'photo',              // Droit à l'image
  'communication',      // Communication commerciale
  'dental',             // Soins dentaires
  'mental_health',      // Santé mentale
  'prevention'          // Prévention / vaccinations
];

const createSchema = Joi.object({
  code: Joi.string().required(),
  title: Joi.string().required(),
  description: Joi.string().optional().allow('', null),
  terms: Joi.string().required(),
  version: Joi.string().default('1.0'),
  consentType: Joi.string().valid(...CONSENT_TYPES).required(),
  isMandatory: Joi.boolean().optional(),
  autoSend: Joi.boolean().optional(),
  validFrom: Joi.date().iso().required(),
  validUntil: Joi.date().iso().optional().allow(null),
  defaultLanguage: Joi.string().valid(...SUPPORTED_LANGUAGES).default('fr'),
  status: Joi.string().valid('draft', 'active', 'inactive').default('draft'),
  metadata: Joi.object({
    speciality: Joi.string().optional(),
    variables: Joi.array().items(Joi.string()).optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    requiredFields: Joi.array().items(Joi.string()).optional()
  }).optional()
});

const updateSchema = createSchema.fork(['code', 'title', 'terms', 'validFrom', 'consentType'], (schema) => schema.optional()).min(1);

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  consentType: Joi.string().optional(),
  status: Joi.string().valid('draft', 'active', 'inactive').optional(),
  search: Joi.string().optional()
});

// Translation schemas
const translationSchema = Joi.object({
  languageCode: Joi.string().valid(...SUPPORTED_LANGUAGES).required(),
  title: Joi.string().required(),
  description: Joi.string().optional().allow('', null),
  terms: Joi.string().required()
});

const templateRoutes = clinicCrudRoutes('ConsentTemplate', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'ConsentTemplate',
  searchFields: ['code', 'title'],

  // Permission configuration - uses clinic_roles as source of truth
  permissions: {
    view: PERMISSIONS.CONSENT_TEMPLATES_VIEW,
    create: PERMISSIONS.CONSENT_TEMPLATES_CREATE,
    update: PERMISSIONS.CONSENT_TEMPLATES_EDIT,
    delete: PERMISSIONS.CONSENT_TEMPLATES_DELETE
  },

  // Exclude camelCase params from direct filters (they need mapping)
  excludeFromFilters: ['consentType'],

  // Map camelCase query params to snake_case column names
  buildQuery: async (queryOptions, params) => {
    if (params.consentType) {
      queryOptions.where.consent_type = params.consentType;
    }
  },

  // Transform camelCase to snake_case and inject company_id before create
  onBeforeCreate: async (data, user) => {
    return {
      company_id: user.companyId,
      code: data.code,
      title: data.title,
      description: data.description,
      terms: data.terms,
      version: data.version || '1.0',
      consent_type: data.consentType,
      is_mandatory: data.isMandatory || false,
      auto_send: data.autoSend || false,
      valid_from: data.validFrom,
      valid_until: data.validUntil,
      default_language: data.defaultLanguage || 'fr',
      status: data.status || 'draft',
      metadata: data.metadata || {}
    };
  },

  // Transform camelCase to snake_case for updates
  onBeforeUpdate: async (data, item, user) => {
    const transformed = {};
    if (data.code !== undefined) transformed.code = data.code;
    if (data.title !== undefined) transformed.title = data.title;
    if (data.description !== undefined) transformed.description = data.description;
    if (data.terms !== undefined) transformed.terms = data.terms;
    if (data.version !== undefined) transformed.version = data.version;
    if (data.consentType !== undefined) transformed.consent_type = data.consentType;
    if (data.isMandatory !== undefined) transformed.is_mandatory = data.isMandatory;
    if (data.autoSend !== undefined) transformed.auto_send = data.autoSend;
    if (data.validFrom !== undefined) transformed.valid_from = data.validFrom;
    if (data.validUntil !== undefined) transformed.valid_until = data.validUntil;
    if (data.defaultLanguage !== undefined) transformed.default_language = data.defaultLanguage;
    if (data.status !== undefined) transformed.status = data.status;
    if (data.metadata !== undefined) transformed.metadata = data.metadata;
    return transformed;
  }
});

router.use('/', templateRoutes);

// =============================================================================
// TRANSLATION MANAGEMENT ROUTES
// =============================================================================

/**
 * GET /:templateId/translations
 * Get all translations for a template
 */
router.get('/:templateId/translations', async (req, res, next) => {
  try {
    const { templateId } = req.params;

    const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');
    const Translation = await getModel(req.clinicDb, 'ConsentTemplateTranslation');

    // Verify template exists
    const template = await ConsentTemplate.findByPk(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: { message: 'Template not found' }
      });
    }

    // Get translations
    const translations = await Translation.findByTemplate(templateId);

    // Include default language content
    const result = {
      defaultLanguage: template.default_language,
      defaultContent: {
        title: template.title,
        description: template.description,
        terms: template.terms
      },
      translations: translations.map(t => ({
        id: t.id,
        languageCode: t.language_code,
        title: t.title,
        description: t.description,
        terms: t.terms,
        translatedBy: t.translated_by,
        createdAt: t.created_at,
        updatedAt: t.updated_at
      })),
      availableLanguages: [template.default_language, ...translations.map(t => t.language_code)]
    };

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /:templateId/translations
 * Add or update a translation for a template
 */
router.post('/:templateId/translations', async (req, res, next) => {
  try {
    const { templateId } = req.params;

    // Validate request body
    const { error, value } = translationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');
    const Translation = await getModel(req.clinicDb, 'ConsentTemplateTranslation');

    // Verify template exists
    const template = await ConsentTemplate.findByPk(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: { message: 'Template not found' }
      });
    }

    // Cannot add translation for default language (it's in the main template)
    if (value.languageCode === template.default_language) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Cannot add translation for default language',
          details: `The default language (${template.default_language}) content is stored in the main template. Update the template instead.`
        }
      });
    }

    // Upsert translation
    const translation = await Translation.upsertTranslation(
      templateId,
      value.languageCode,
      {
        title: value.title,
        description: value.description,
        terms: value.terms
      },
      req.user.id
    );

    logger.info('Consent template translation created/updated', {
      templateId,
      languageCode: value.languageCode,
      userId: req.user.id,
      clinicId: req.clinicId
    });

    res.status(201).json({
      success: true,
      data: {
        id: translation.id,
        consentTemplateId: translation.consent_template_id,
        languageCode: translation.language_code,
        title: translation.title,
        description: translation.description,
        terms: translation.terms,
        translatedBy: translation.translated_by,
        createdAt: translation.created_at,
        updatedAt: translation.updated_at
      },
      message: 'Translation saved successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /:templateId/translations/:languageCode
 * Get a specific translation
 */
router.get('/:templateId/translations/:languageCode', async (req, res, next) => {
  try {
    const { templateId, languageCode } = req.params;

    const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');
    const Translation = await getModel(req.clinicDb, 'ConsentTemplateTranslation');

    // Verify template exists
    const template = await ConsentTemplate.findByPk(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: { message: 'Template not found' }
      });
    }

    // If requesting default language, return template content
    if (languageCode === template.default_language) {
      return res.json({
        success: true,
        data: {
          languageCode: template.default_language,
          title: template.title,
          description: template.description,
          terms: template.terms,
          isDefault: true
        }
      });
    }

    // Otherwise, find translation
    const translation = await Translation.findByLanguage(templateId, languageCode);
    if (!translation) {
      return res.status(404).json({
        success: false,
        error: { message: `Translation not found for language: ${languageCode}` }
      });
    }

    res.json({
      success: true,
      data: {
        id: translation.id,
        languageCode: translation.language_code,
        title: translation.title,
        description: translation.description,
        terms: translation.terms,
        translatedBy: translation.translated_by,
        createdAt: translation.created_at,
        updatedAt: translation.updated_at,
        isDefault: false
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /:templateId/translations/:languageCode
 * Delete a specific translation
 */
router.delete('/:templateId/translations/:languageCode', async (req, res, next) => {
  try {
    const { templateId, languageCode } = req.params;

    const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');
    const Translation = await getModel(req.clinicDb, 'ConsentTemplateTranslation');

    // Verify template exists
    const template = await ConsentTemplate.findByPk(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: { message: 'Template not found' }
      });
    }

    // Cannot delete default language
    if (languageCode === template.default_language) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Cannot delete default language translation',
          details: 'Delete the entire template instead, or change the default language first.'
        }
      });
    }

    // Find and delete translation
    const translation = await Translation.findByLanguage(templateId, languageCode);
    if (!translation) {
      return res.status(404).json({
        success: false,
        error: { message: `Translation not found for language: ${languageCode}` }
      });
    }

    await translation.destroy();

    logger.info('Consent template translation deleted', {
      templateId,
      languageCode,
      userId: req.user.id,
      clinicId: req.clinicId
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * GET /:templateId/content/:languageCode
 * Get template content in a specific language (with fallback to default)
 * This is the endpoint to use when presenting consent to a patient
 */
router.get('/:templateId/content/:languageCode', async (req, res, next) => {
  try {
    const { templateId, languageCode } = req.params;

    const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');
    const Translation = await getModel(req.clinicDb, 'ConsentTemplateTranslation');

    // Get template with all info
    const template = await ConsentTemplate.findByPk(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: { message: 'Template not found' }
      });
    }

    let content;
    let usedLanguage = languageCode;

    // If requesting default language, use template content
    if (languageCode === template.default_language) {
      content = {
        title: template.title,
        description: template.description,
        terms: template.terms
      };
    } else {
      // Try to find translation
      const translation = await Translation.findByLanguage(templateId, languageCode);

      if (translation) {
        content = {
          title: translation.title,
          description: translation.description,
          terms: translation.terms
        };
      } else {
        // Fallback to default language
        content = {
          title: template.title,
          description: template.description,
          terms: template.terms
        };
        usedLanguage = template.default_language;
      }
    }

    res.json({
      success: true,
      data: {
        templateId: template.id,
        code: template.code,
        consentType: template.consent_type,
        version: template.version,
        isMandatory: template.is_mandatory,
        requestedLanguage: languageCode,
        usedLanguage: usedLanguage,
        fallbackUsed: usedLanguage !== languageCode,
        content
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

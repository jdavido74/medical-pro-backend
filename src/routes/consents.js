/**
 * Consents Routes - Clinic Isolated
 * CRUD operations for consents with clinic-specific database isolation
 * Includes GDPR-compliant electronic signature tracking
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const { getModel } = require('../base/ModelFactory');
const { logger } = require('../utils/logger');
const { PERMISSIONS } = require('../utils/permissionConstants');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

// Supported languages for consent
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
  patientId: Joi.string().uuid().required(),
  appointmentId: Joi.string().uuid().optional(),
  productServiceId: Joi.string().uuid().optional(),
  consentTemplateId: Joi.string().uuid().optional(),
  consentType: Joi.string().valid(...CONSENT_TYPES).required(),
  title: Joi.string().required(),
  description: Joi.string().optional(),
  terms: Joi.string().required(),
  relatedDocumentId: Joi.string().uuid().optional(),
  // Multilingual support
  languageCode: Joi.string().valid(...SUPPORTED_LANGUAGES).default('fr'),
  templateVersion: Joi.string().optional()
});

const updateSchema = Joi.object({
  status: Joi.string().valid('pending', 'accepted', 'rejected').optional(),
  signatureMethod: Joi.string().valid('digital', 'checkbox', 'pin').optional()
}).min(1);

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  patientId: Joi.string().uuid().optional(),
  status: Joi.string().valid('pending', 'accepted', 'rejected').optional(),
  consentType: Joi.string().optional()
});

const consentRoutes = clinicCrudRoutes('Consent', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'Consent',
  searchFields: ['title', 'consent_type'],

  // Permission configuration - uses clinic_roles as source of truth
  permissions: {
    view: PERMISSIONS.CONSENTS_VIEW,
    create: PERMISSIONS.CONSENTS_CREATE,
    update: PERMISSIONS.CONSENTS_EDIT,
    delete: PERMISSIONS.CONSENTS_REVOKE
  },

  // Transform camelCase to snake_case and inject company_id before create
  onBeforeCreate: async (data, user) => {
    return {
      company_id: user.companyId,
      patient_id: data.patientId,
      appointment_id: data.appointmentId,
      product_service_id: data.productServiceId,
      consent_template_id: data.consentTemplateId,
      consent_type: data.consentType,
      title: data.title,
      description: data.description,
      terms: data.terms,
      related_document_id: data.relatedDocumentId,
      // Multilingual support - record language and template version for historization
      language_code: data.languageCode || 'fr',
      template_version: data.templateVersion
    };
  },

  // Transform camelCase to snake_case for updates
  onBeforeUpdate: async (data, item, user) => {
    const transformed = {};
    if (data.status !== undefined) transformed.status = data.status;
    if (data.signatureMethod !== undefined) transformed.signature_method = data.signatureMethod;
    return transformed;
  }
});

router.use('/', consentRoutes);

// Sign consent electronically (GDPR-compliant) - Clinic Isolated
router.patch('/:id/sign', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { signatureMethod = 'digital', timezone = 'unknown' } = req.body;

    const Consent = await getModel(req.clinicDb, 'Consent');

    const consent = await Consent.findByPk(id, {
      where: { deleted_at: null }
    });
    if (!consent) {
      return res.status(404).json({ success: false, error: { message: 'Consent not found' } });
    }

    // Update signature (GDPR-compliant with audit trail)
    await consent.update({
      status: 'accepted',
      signed_at: new Date(),
      signature_method: signatureMethod,
      ip_address: req.ip,
      device_info: {
        userAgent: req.get('user-agent'),
        platform: req.headers['sec-ch-ua-platform'] || 'unknown',
        timezone: timezone
      }
    });

    logger.info(`Consent signed electronically`, {
      consentId: consent.id,
      patientId: consent.patient_id,
      ipAddress: req.ip,
      signatureMethod: signatureMethod,
      clinicId: req.clinicId
    });

    res.json({
      success: true,
      data: consent,
      message: 'Consent signed successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Get consents for patient (clinic-isolated)
router.get('/patient/:patientId', async (req, res, next) => {
  try {
    const { patientId } = req.params;
    const { status } = req.query;

    const Consent = await getModel(req.clinicDb, 'Consent');

    const where = {
      patient_id: patientId,
      deleted_at: null
    };

    if (status) {
      where.status = status;
    }

    const consents = await Consent.findAll({
      where,
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: consents,
      count: consents.length
    });
  } catch (error) {
    next(error);
  }
});

// Create consent from template with specific language (for historization)
// Requires consents.create or consents.assign permission
router.post('/from-template', requirePermission([PERMISSIONS.CONSENTS_CREATE, PERMISSIONS.CONSENTS_ASSIGN], false), async (req, res, next) => {
  try {
    const {
      templateId,
      patientId,
      appointmentId,
      productServiceId,
      languageCode = 'fr'
    } = req.body;

    if (!templateId || !patientId) {
      return res.status(400).json({
        success: false,
        error: { message: 'templateId and patientId are required' }
      });
    }

    const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');
    const Translation = await getModel(req.clinicDb, 'ConsentTemplateTranslation');
    const Consent = await getModel(req.clinicDb, 'Consent');

    // Get template
    const template = await ConsentTemplate.findByPk(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: { message: 'Template not found' }
      });
    }

    // Get content in requested language (with fallback to default)
    let content;
    let usedLanguage = languageCode;

    if (languageCode === template.default_language) {
      content = {
        title: template.title,
        description: template.description,
        terms: template.terms
      };
    } else {
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

    // Create consent with template version for historization
    const consent = await Consent.create({
      company_id: req.user.companyId,
      patient_id: patientId,
      appointment_id: appointmentId,
      product_service_id: productServiceId,
      consent_template_id: templateId,
      consent_type: template.consent_type,
      title: content.title,
      description: content.description,
      terms: content.terms,
      language_code: usedLanguage,
      template_version: template.version,
      status: 'pending'
    });

    logger.info('Consent created from template', {
      consentId: consent.id,
      templateId,
      templateVersion: template.version,
      languageCode: usedLanguage,
      patientId,
      clinicId: req.clinicId
    });

    res.status(201).json({
      success: true,
      data: consent,
      meta: {
        requestedLanguage: languageCode,
        usedLanguage,
        fallbackUsed: usedLanguage !== languageCode,
        templateVersion: template.version
      },
      message: 'Consent created from template'
    });
  } catch (error) {
    next(error);
  }
});

// Get consents for appointment (clinic-isolated)
router.get('/appointment/:appointmentId', async (req, res, next) => {
  try {
    const { appointmentId } = req.params;

    const Consent = await getModel(req.clinicDb, 'Consent');

    const consents = await Consent.findAll({
      where: {
        appointment_id: appointmentId,
        deleted_at: null
      },
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: consents
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

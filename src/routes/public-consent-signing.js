/**
 * Public Consent Signing Routes
 *
 * These routes are PUBLIC (no authentication required)
 * Access is controlled via secure signing tokens
 *
 * Used by patients to view and sign consents from email links or tablet
 */

const express = require('express');
const Joi = require('joi');
const { Sequelize } = require('sequelize');
const { logger } = require('../utils/logger');

const router = express.Router();

// Signature validation schema
const signatureSchema = Joi.object({
  signatureImage: Joi.string().required(), // Base64 encoded signature image
  signatureMethod: Joi.string().valid('digital', 'checkbox', 'pin').default('digital'),
  timezone: Joi.string().default('Europe/Paris'),
  deviceType: Joi.string().valid('mobile', 'tablet', 'desktop').optional()
});

/**
 * Helper to get models for a clinic database by company ID
 */
async function getClinicModels(companyId) {
  const clinicDbName = `medicalpro_clinic_${companyId.replace(/-/g, '_')}`;

  // Create connection to clinic database
  const clinicDb = new Sequelize(clinicDbName, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  });

  // Import model factories
  const createConsentSigningRequest = require('../models/clinic/ConsentSigningRequest');
  const createConsentTemplate = require('../models/clinic/ConsentTemplate');
  const createConsentTemplateTranslation = require('../models/clinic/ConsentTemplateTranslation');
  const createConsent = require('../models/clinic/Consent');
  const createPatient = require('../models/clinic/Patient');

  return {
    db: clinicDb,
    ConsentSigningRequest: createConsentSigningRequest(clinicDb),
    ConsentTemplate: createConsentTemplate(clinicDb),
    ConsentTemplateTranslation: createConsentTemplateTranslation(clinicDb),
    Consent: createConsent(clinicDb),
    Patient: createPatient(clinicDb)
  };
}

/**
 * Find signing request by token across all clinic databases
 * This is necessary because we don't know which clinic the token belongs to
 */
async function findSigningRequestByToken(token) {
  const { Sequelize: Seq } = require('sequelize');

  // Connect to central database to get list of clinics
  const centralDb = new Seq(
    process.env.DB_NAME || 'medicalpro_central',
    process.env.DB_USER || 'medicalpro',
    process.env.DB_PASSWORD || 'medicalpro2024',
    {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: false
    }
  );

  try {
    // Get all clinic companies
    const [companies] = await centralDb.query(
      'SELECT id FROM companies WHERE is_active = true AND deleted_at IS NULL'
    );

    // Search each clinic database for the token
    for (const company of companies) {
      try {
        const models = await getClinicModels(company.id);
        const request = await models.ConsentSigningRequest.findOne({
          where: { signing_token: token }
        });

        if (request) {
          return { request, models, companyId: company.id };
        }

        await models.db.close();
      } catch (err) {
        // Clinic database might not exist or have the table yet
        console.log(`Skipping clinic ${company.id}: ${err.message}`);
        continue;
      }
    }

    return null;
  } finally {
    await centralDb.close();
  }
}

/**
 * GET /api/v1/public/sign/:token
 * Get consent details for signing page (public access)
 */
router.get('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    if (!token || token.length < 32) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid token format' }
      });
    }

    const result = await findSigningRequestByToken(token);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: { message: 'Signing request not found or expired' }
      });
    }

    const { request, models, companyId } = result;

    // Check if request is still valid
    if (request.status !== 'pending') {
      await models.db.close();
      return res.status(400).json({
        success: false,
        error: {
          message: request.status === 'signed'
            ? 'This consent has already been signed'
            : 'This signing request is no longer valid',
          status: request.status
        }
      });
    }

    if (new Date() > new Date(request.expires_at)) {
      await request.update({ status: 'expired' });
      await models.db.close();
      return res.status(400).json({
        success: false,
        error: { message: 'This signing request has expired' }
      });
    }

    // Mark as viewed
    await request.markViewed(req.ip);

    // Get template and patient info
    const template = await models.ConsentTemplate.findByPk(request.consent_template_id);
    const patient = await models.Patient.findByPk(request.patient_id);

    if (!template || !patient) {
      await models.db.close();
      return res.status(404).json({
        success: false,
        error: { message: 'Template or patient not found' }
      });
    }

    // Get content in requested language (with fallback)
    let content;
    let usedLanguage = request.language_code;

    if (request.language_code === template.default_language) {
      content = {
        title: template.title,
        description: template.description,
        terms: template.terms
      };
    } else {
      const translation = await models.ConsentTemplateTranslation.findOne({
        where: {
          consent_template_id: template.id,
          language_code: request.language_code
        }
      });

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

    // Use filled (substituted) content if available, fallback to template for old records
    const displayContent = {
      title: request.filled_title || content.title,
      description: request.filled_description || content.description,
      terms: request.filled_terms || content.terms
    };

    await models.db.close();

    logger.info('Consent signing page accessed', {
      requestId: request.id,
      patientId: patient.id,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: {
        requestId: request.id,
        expiresAt: request.expires_at,
        status: request.status,
        language: usedLanguage,
        patient: {
          firstName: patient.first_name,
          lastName: patient.last_name
        },
        consent: {
          title: displayContent.title,
          description: displayContent.description,
          terms: displayContent.terms,
          consentType: template.consent_type,
          templateVersion: template.version
        },
        customMessage: request.custom_message,
        viewedAt: request.viewed_at
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/public/sign/:token
 * Submit signature for consent (public access)
 */
router.post('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const { error, value } = signatureSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { signatureImage, signatureMethod, timezone, deviceType } = value;

    const result = await findSigningRequestByToken(token);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: { message: 'Signing request not found' }
      });
    }

    const { request, models, companyId } = result;

    // Validate request is still signable
    if (request.status !== 'pending') {
      await models.db.close();
      return res.status(400).json({
        success: false,
        error: {
          message: request.status === 'signed'
            ? 'This consent has already been signed'
            : 'This signing request is no longer valid'
        }
      });
    }

    if (new Date() > new Date(request.expires_at)) {
      await request.update({ status: 'expired' });
      await models.db.close();
      return res.status(400).json({
        success: false,
        error: { message: 'This signing request has expired' }
      });
    }

    // Get template for consent creation
    const template = await models.ConsentTemplate.findByPk(request.consent_template_id);
    const patient = await models.Patient.findByPk(request.patient_id);

    if (!template) {
      await models.db.close();
      return res.status(404).json({
        success: false,
        error: { message: 'Template not found' }
      });
    }

    // Get content in requested language
    let content;
    let usedLanguage = request.language_code;

    if (request.language_code === template.default_language) {
      content = {
        title: template.title,
        description: template.description,
        terms: template.terms
      };
    } else {
      const translation = await models.ConsentTemplateTranslation.findOne({
        where: {
          consent_template_id: template.id,
          language_code: request.language_code
        }
      });

      if (translation) {
        content = {
          title: translation.title,
          description: translation.description,
          terms: translation.terms
        };
      } else {
        content = {
          title: template.title,
          description: template.description,
          terms: template.terms
        };
        usedLanguage = template.default_language;
      }
    }

    // Device info for GDPR compliance
    const deviceInfo = {
      userAgent: req.get('user-agent'),
      platform: req.headers['sec-ch-ua-platform'] || 'unknown',
      timezone,
      deviceType: deviceType || 'unknown',
      signedAt: new Date().toISOString()
    };

    // Use filled (substituted) content if available, fallback to template for old records
    const signedContent = {
      title: request.filled_title || content.title,
      description: request.filled_description || content.description,
      terms: request.filled_terms || content.terms
    };

    // Create the signed consent with actual patient data
    const consent = await models.Consent.create({
      company_id: companyId,
      patient_id: request.patient_id,
      appointment_id: request.appointment_id,
      consent_template_id: request.consent_template_id,
      consent_type: template.consent_type,
      title: signedContent.title,
      description: signedContent.description,
      terms: signedContent.terms,
      status: 'accepted',
      signed_at: new Date(),
      signature_method: signatureMethod,
      signature_image: signatureImage,
      ip_address: req.ip,
      device_info: deviceInfo,
      language_code: usedLanguage,
      template_version: template.version,
      signing_request_id: request.id
    });

    // Complete the signing request
    await request.complete(consent.id, req.ip, deviceInfo);

    await models.db.close();

    logger.info('Consent signed successfully', {
      consentId: consent.id,
      requestId: request.id,
      patientId: request.patient_id,
      ipAddress: req.ip,
      signatureMethod
    });

    res.status(201).json({
      success: true,
      data: {
        consentId: consent.id,
        signedAt: consent.signed_at,
        status: 'accepted'
      },
      message: 'Consent signed successfully. Thank you!'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/public/sign/:token/status
 * Check status of a signing request (for polling from client)
 */
router.get('/:token/status', async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await findSigningRequestByToken(token);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: { message: 'Signing request not found' }
      });
    }

    const { request, models } = result;

    // Check expiration
    if (request.status === 'pending' && new Date() > new Date(request.expires_at)) {
      await request.update({ status: 'expired' });
    }

    await models.db.close();

    res.json({
      success: true,
      data: {
        status: request.status,
        signedAt: request.signed_at,
        expiresAt: request.expires_at,
        viewedAt: request.viewed_at
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

/**
 * Consent Signing Routes
 *
 * Authenticated routes for creating signing requests (clinic-isolated)
 * Includes CRUD operations for signing requests within clinic context
 */

const express = require('express');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const { getModel } = require('../base/ModelFactory');
const { logger } = require('../utils/logger');
const emailService = require('../services/emailService');
const { validateParams, schemas } = require('../utils/validationSchemas');
const { PERMISSIONS } = require('../utils/permissionConstants');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

// Validation schemas
const createSigningRequestSchema = Joi.object({
  patientId: Joi.string().uuid().required(),
  consentTemplateId: Joi.string().uuid().required(),
  appointmentId: Joi.string().uuid().optional(),
  sentVia: Joi.string().valid('email', 'sms', 'tablet', 'link').default('email'),
  recipientEmail: Joi.string().email().when('sentVia', {
    is: 'email',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  recipientPhone: Joi.string().optional(),
  languageCode: Joi.string().valid('fr', 'en', 'es', 'de', 'it', 'pt').optional(),
  customMessage: Joi.string().max(1000).optional(),
  expiresInHours: Joi.number().min(1).max(168).default(48) // 1 hour to 7 days
});

const updateSigningRequestSchema = Joi.object({
  status: Joi.string().valid('cancelled').optional(),
  customMessage: Joi.string().max(1000).optional()
}).min(1);

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  patientId: Joi.string().uuid().optional(),
  appointmentId: Joi.string().uuid().optional(),
  status: Joi.string().valid('pending', 'signed', 'expired', 'cancelled').optional()
});

// Create a new signing request
// Requires consents.assign permission
router.post('/', requirePermission(PERMISSIONS.CONSENTS_ASSIGN), async (req, res, next) => {
  try {
    const { error, value } = createSigningRequestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const {
      patientId,
      consentTemplateId,
      appointmentId,
      sentVia,
      recipientEmail,
      recipientPhone,
      languageCode,
      customMessage,
      expiresInHours
    } = value;

    const ConsentSigningRequest = await getModel(req.clinicDb, 'ConsentSigningRequest');
    const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');
    const Patient = await getModel(req.clinicDb, 'Patient');

    // Verify template exists
    const template = await ConsentTemplate.findByPk(consentTemplateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: { message: 'Consent template not found' }
      });
    }

    // Verify patient exists
    const patient = await Patient.findByPk(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: { message: 'Patient not found' }
      });
    }

    // Use patient email if not provided
    const email = recipientEmail || patient.email;
    if (sentVia === 'email' && !email) {
      return res.status(400).json({
        success: false,
        error: { message: 'Patient has no email address. Please provide recipientEmail.' }
      });
    }

    // Resolve language: explicit param > patient preference > default
    const effectiveLanguage = languageCode || patient.preferred_language || 'fr';

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresInHours);

    // Create the signing request
    const signingRequest = await ConsentSigningRequest.create({
      company_id: req.user.companyId,
      patient_id: patientId,
      consent_template_id: consentTemplateId,
      appointment_id: appointmentId,
      signing_token: uuidv4(),
      expires_at: expiresAt,
      status: 'pending',
      sent_via: sentVia,
      recipient_email: email,
      recipient_phone: recipientPhone || patient.phone,
      language_code: effectiveLanguage,
      custom_message: customMessage,
      ip_address_sent: req.ip,
      created_by: req.user.userId
    });

    // Generate signing URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const signingUrl = `${baseUrl}/sign-consent/${signingRequest.signing_token}`;

    // Mark as sent
    await signingRequest.update({ sent_at: new Date() });

    // Send email if sent via email
    let emailResult = null;
    if (sentVia === 'email' && email) {
      try {
        // Get clinic name from company (would need to add this lookup)
        const clinicName = req.user.companyName || 'Clinique';

        emailResult = await emailService.sendConsentSigningRequest({
          email,
          patientName: `${patient.first_name} ${patient.last_name}`,
          clinicName,
          consentTitle: template.title,
          signingUrl,
          expiresAt: expiresAt.toISOString(),
          customMessage,
          language: effectiveLanguage
        });

        logger.info('Consent signing email sent', {
          requestId: signingRequest.id,
          email,
          clinicId: req.clinicId
        });
      } catch (emailError) {
        logger.error('Failed to send consent signing email', {
          requestId: signingRequest.id,
          email,
          error: emailError.message
        });
        // Don't fail the request if email fails
      }
    }

    logger.info('Consent signing request created', {
      requestId: signingRequest.id,
      patientId,
      templateId: consentTemplateId,
      sentVia,
      expiresAt,
      clinicId: req.clinicId
    });

    res.status(201).json({
      success: true,
      data: {
        ...signingRequest.toJSON(),
        signingUrl,
        patient: {
          id: patient.id,
          firstName: patient.first_name,
          lastName: patient.last_name,
          email: patient.email
        },
        template: {
          id: template.id,
          title: template.title,
          consentType: template.consent_type
        }
      },
      message: 'Signing request created successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Get all signing requests (with filters)
// Requires consents.view permission
router.get('/', requirePermission(PERMISSIONS.CONSENTS_VIEW), async (req, res, next) => {
  try {
    const { error, value } = querySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { page, limit, patientId, appointmentId, status } = value;
    const offset = (page - 1) * limit;

    const ConsentSigningRequest = await getModel(req.clinicDb, 'ConsentSigningRequest');

    const where = { company_id: req.user.companyId };
    if (patientId) where.patient_id = patientId;
    if (appointmentId) where.appointment_id = appointmentId;
    if (status) where.status = status;

    const { count, rows } = await ConsentSigningRequest.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get signing requests for a patient
// Requires consents.view permission
router.get('/patient/:patientId', requirePermission(PERMISSIONS.CONSENTS_VIEW), validateParams(schemas.patientIdParam), async (req, res, next) => {
  try {
    const { patientId } = req.params;
    const { status } = req.query;

    const ConsentSigningRequest = await getModel(req.clinicDb, 'ConsentSigningRequest');

    const where = {
      patient_id: patientId,
      company_id: req.user.companyId
    };
    if (status) where.status = status;

    const requests = await ConsentSigningRequest.findAll({
      where,
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: requests,
      count: requests.length
    });
  } catch (error) {
    next(error);
  }
});

// Get signing requests for an appointment
// Requires consents.view permission
router.get('/appointment/:appointmentId', requirePermission(PERMISSIONS.CONSENTS_VIEW), validateParams(schemas.appointmentIdParam), async (req, res, next) => {
  try {
    const { appointmentId } = req.params;

    const ConsentSigningRequest = await getModel(req.clinicDb, 'ConsentSigningRequest');

    const requests = await ConsentSigningRequest.findAll({
      where: {
        appointment_id: appointmentId,
        company_id: req.user.companyId
      },
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    next(error);
  }
});

// Get a single signing request
// Requires consents.view permission
router.get('/:id', requirePermission(PERMISSIONS.CONSENTS_VIEW), validateParams(schemas.uuidParam), async (req, res, next) => {
  try {
    const { id } = req.params;

    const ConsentSigningRequest = await getModel(req.clinicDb, 'ConsentSigningRequest');

    const request = await ConsentSigningRequest.findOne({
      where: {
        id,
        company_id: req.user.companyId
      }
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: { message: 'Signing request not found' }
      });
    }

    // Generate signing URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const signingUrl = `${baseUrl}/sign-consent/${request.signing_token}`;

    res.json({
      success: true,
      data: {
        ...request.toJSON(),
        signingUrl
      }
    });
  } catch (error) {
    next(error);
  }
});

// Cancel a signing request
// Requires consents.edit or consents.revoke permission
router.patch('/:id/cancel', requirePermission([PERMISSIONS.CONSENTS_EDIT, PERMISSIONS.CONSENTS_REVOKE], false), async (req, res, next) => {
  try {
    const { id } = req.params;

    const ConsentSigningRequest = await getModel(req.clinicDb, 'ConsentSigningRequest');

    const request = await ConsentSigningRequest.findOne({
      where: {
        id,
        company_id: req.user.companyId
      }
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: { message: 'Signing request not found' }
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: { message: 'Only pending requests can be cancelled' }
      });
    }

    await request.cancel();

    logger.info('Consent signing request cancelled', {
      requestId: id,
      clinicId: req.clinicId
    });

    res.json({
      success: true,
      data: request,
      message: 'Signing request cancelled'
    });
  } catch (error) {
    next(error);
  }
});

// Send reminder for pending request
// Requires consents.assign permission
router.post('/:id/remind', requirePermission(PERMISSIONS.CONSENTS_ASSIGN), async (req, res, next) => {
  try {
    const { id } = req.params;

    const ConsentSigningRequest = await getModel(req.clinicDb, 'ConsentSigningRequest');

    const request = await ConsentSigningRequest.findOne({
      where: {
        id,
        company_id: req.user.companyId
      }
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: { message: 'Signing request not found' }
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: { message: 'Only pending requests can receive reminders' }
      });
    }

    if (!request.isValid()) {
      return res.status(400).json({
        success: false,
        error: { message: 'Request has expired' }
      });
    }

    await request.sendReminder();

    // TODO: Send actual email/SMS reminder via email service

    logger.info('Consent signing reminder sent', {
      requestId: id,
      reminderCount: request.reminder_count,
      clinicId: req.clinicId
    });

    res.json({
      success: true,
      data: request,
      message: `Reminder sent (${request.reminder_count} total)`
    });
  } catch (error) {
    next(error);
  }
});

// Delete a signing request
// Requires consents.delete permission
router.delete('/:id', requirePermission(PERMISSIONS.CONSENTS_DELETE), async (req, res, next) => {
  try {
    const { id } = req.params;

    const ConsentSigningRequest = await getModel(req.clinicDb, 'ConsentSigningRequest');

    const request = await ConsentSigningRequest.findOne({
      where: {
        id,
        company_id: req.user.companyId
      }
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: { message: 'Signing request not found' }
      });
    }

    await request.destroy();

    logger.info('Consent signing request deleted', {
      requestId: id,
      clinicId: req.clinicId
    });

    res.json({
      success: true,
      message: 'Signing request deleted'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

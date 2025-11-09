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

const router = express.Router();

const createSchema = Joi.object({
  patientId: Joi.string().uuid().required(),
  appointmentId: Joi.string().uuid().optional(),
  productServiceId: Joi.string().uuid().optional(),
  consentTemplateId: Joi.string().uuid().optional(),
  consentType: Joi.string().valid('medical_treatment', 'data_processing', 'photo', 'communication').required(),
  title: Joi.string().required(),
  description: Joi.string().optional(),
  terms: Joi.string().required(),
  relatedDocumentId: Joi.string().uuid().optional()
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
  searchFields: ['title', 'consentType']
});

router.use('/', consentRoutes);

// Sign consent electronically (GDPR-compliant) - Clinic Isolated
router.patch('/:id/sign', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { signatureMethod = 'digital', timezone = 'unknown' } = req.body;

    const Consent = await getModel(req.clinicDb, 'Consent');

    const consent = await Consent.findByPk(id, {
      where: { deletedAt: null }
    });
    if (!consent) {
      return res.status(404).json({ success: false, error: { message: 'Consent not found' } });
    }

    // Update signature (GDPR-compliant with audit trail)
    await consent.update({
      status: 'accepted',
      signedAt: new Date(),
      signatureMethod: signatureMethod,
      ipAddress: req.ip,
      deviceInfo: {
        userAgent: req.get('user-agent'),
        platform: req.headers['sec-ch-ua-platform'] || 'unknown',
        timezone: timezone
      }
    });

    logger.info(`Consent signed electronically`, {
      consentId: consent.id,
      patientId: consent.patientId,
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
      patientId: patientId,
      deletedAt: null
    };

    if (status) {
      where.status = status;
    }

    const consents = await Consent.findAll({
      where,
      order: [['createdAt', 'DESC']]
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

// Get consents for appointment (clinic-isolated)
router.get('/appointment/:appointmentId', async (req, res, next) => {
  try {
    const { appointmentId } = req.params;

    const Consent = await getModel(req.clinicDb, 'Consent');

    const consents = await Consent.findAll({
      where: {
        appointmentId: appointmentId,
        deletedAt: null
      },
      order: [['createdAt', 'DESC']]
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

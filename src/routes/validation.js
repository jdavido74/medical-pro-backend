/**
 * Validation Routes - External API Services
 * SIRET, NIF, VAT validation against external APIs
 * These routes do not require clinic-specific isolation (external data validation)
 */

const express = require('express');
const { logger } = require('../utils/logger');
const Joi = require('joi');

const router = express.Router();

// Import validation services
const FranceInseeValidator = require('../services/inseeService');
const SpainNifValidator = require('../services/spainService');

// Schémas de validation
const siretValidationSchema = Joi.object({
  siret: Joi.string().pattern(/^\d{14}$/).required()
});

const nifValidationSchema = Joi.object({
  nif: Joi.string().pattern(/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/).required()
});

const vatValidationSchema = Joi.object({
  vatNumber: Joi.string().min(8).max(15).required(),
  country: Joi.string().valid('FR', 'ES').required()
});

/**
 * @route POST /api/v1/validation/siret
 * @desc Validate French SIRET number via INSEE API
 * @access Private
 */
router.post('/siret', async (req, res, next) => {
  try {
    // Validation
    const { error, value } = siretValidationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: 'SIRET must be exactly 14 digits'
        }
      });
    }

    const { siret } = value;

    // Utiliser le service INSEE
    const inseeValidator = new FranceInseeValidator();
    const result = await inseeValidator.validate(siret);

    logger.info(`SIRET validation request: ${siret}`, {
      companyId: req.user.companyId,
      userId: req.user.id,
      valid: result.valid
    });

    if (result.valid) {
      res.json({
        success: true,
        data: {
          valid: true,
          siret: result.data.siret,
          siren: result.data.siren,
          companyName: result.data.name,
          address: result.data.address,
          activity: result.data.activity,
          status: result.data.status
        },
        message: 'SIRET is valid'
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid SIRET',
          details: result.error || 'SIRET number not found'
        }
      });
    }

  } catch (error) {
    logger.error(`SIRET validation error: ${error.message}`, {
      companyId: req.user.companyId,
      userId: req.user.id,
      siret: req.body.siret
    });

    res.status(500).json({
      success: false,
      error: {
        message: 'Validation service error',
        details: 'Unable to validate SIRET at this time'
      }
    });
  }
});

/**
 * @route POST /api/v1/validation/nif
 * @desc Validate Spanish NIF number
 * @access Private
 */
router.post('/nif', async (req, res, next) => {
  try {
    // Validation
    const { error, value } = nifValidationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: 'NIF format is invalid'
        }
      });
    }

    const { nif } = value;

    // Utiliser le service NIF España
    const nifValidator = new SpainNifValidator();
    const result = await nifValidator.validate(nif);

    logger.info(`NIF validation request: ${nif}`, {
      companyId: req.user.companyId,
      userId: req.user.id,
      valid: result.valid
    });

    if (result.valid) {
      res.json({
        success: true,
        data: {
          valid: true,
          nif: result.data.nif,
          entityType: result.data.type,
          validated: result.data.validated
        },
        message: 'NIF format is valid'
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid NIF',
          details: result.error || 'NIF format or check digit is invalid'
        }
      });
    }

  } catch (error) {
    logger.error(`NIF validation error: ${error.message}`, {
      companyId: req.user.companyId,
      userId: req.user.id,
      nif: req.body.nif
    });

    res.status(500).json({
      success: false,
      error: {
        message: 'Validation service error',
        details: 'Unable to validate NIF at this time'
      }
    });
  }
});

/**
 * @route POST /api/v1/validation/vat
 * @desc Validate VAT number (basic format validation)
 * @access Private
 */
router.post('/vat', async (req, res, next) => {
  try {
    // Validation
    const { error, value } = vatValidationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(detail => detail.message).join(', ')
        }
      });
    }

    const { vatNumber, country } = value;

    let isValidFormat = false;
    let expectedFormat = '';

    // Validation par pays
    if (country === 'FR') {
      // Format français : FR + 11 chiffres
      isValidFormat = /^FR\d{11}$/.test(vatNumber.replace(/\s/g, ''));
      expectedFormat = 'FR + 11 digits';
    } else if (country === 'ES') {
      // Format espagnol : ES + NIF
      isValidFormat = /^ES[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(vatNumber.replace(/\s/g, ''));
      expectedFormat = 'ES + NIF format';
    }

    logger.info(`VAT validation request: ${vatNumber} (${country})`, {
      companyId: req.user.companyId,
      userId: req.user.id,
      valid: isValidFormat
    });

    if (isValidFormat) {
      res.json({
        success: true,
        data: {
          valid: true,
          vatNumber: vatNumber.replace(/\s/g, ''),
          country,
          format: expectedFormat
        },
        message: 'VAT number format is valid'
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid VAT number format',
          details: `Expected format: ${expectedFormat}`
        }
      });
    }

  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/validation/info
 * @desc Get validation service information
 * @access Private
 */
router.get('/info', (req, res) => {
  res.json({
    success: true,
    data: {
      services: {
        siret: {
          country: 'FR',
          description: 'French SIRET validation via INSEE API',
          format: '14 digits',
          features: ['Real-time validation', 'Company information', 'Address lookup']
        },
        nif: {
          country: 'ES',
          description: 'Spanish NIF format validation',
          format: 'Letter + 7 digits + control character',
          features: ['Format validation', 'Check digit verification', 'Entity type identification']
        },
        vat: {
          countries: ['FR', 'ES'],
          description: 'VAT number format validation',
          features: ['Format validation by country']
        }
      },
      limits: {
        rateLimit: '100 requests per 15 minutes',
        apis: {
          insee: 'Requires API token',
          nif: 'Local validation only'
        }
      }
    }
  });
});

module.exports = router;
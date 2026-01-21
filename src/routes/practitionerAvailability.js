/**
 * Practitioner Availability Routes
 * Gestion des disponibilités des praticiens par semaine calendaire
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');
const createAvailabilityService = require('../services/availabilityService');
const { VALID_DAYS, DEFAULT_AVAILABILITY } = require('../services/availabilityService');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

// Validation schemas
const timeSlotSchema = Joi.object({
  start: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  end: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
});

const dayAvailabilitySchema = Joi.object({
  enabled: Joi.boolean().required(),
  slots: Joi.array().items(timeSlotSchema).required()
});

const availabilitySchema = Joi.object({
  monday: dayAvailabilitySchema.required(),
  tuesday: dayAvailabilitySchema.required(),
  wednesday: dayAvailabilitySchema.required(),
  thursday: dayAvailabilitySchema.required(),
  friday: dayAvailabilitySchema.required(),
  saturday: dayAvailabilitySchema.required(),
  sunday: dayAvailabilitySchema.required()
});

const weekParamsSchema = Joi.object({
  providerId: Joi.string().uuid().required(),
  year: Joi.number().integer().min(2020).max(2100).required(),
  week: Joi.number().integer().min(1).max(53).required()
});

const saveWeekBodySchema = Joi.object({
  availability: availabilitySchema.required(),
  notes: Joi.string().allow('', null).optional()
});

const copyWeekParamsSchema = Joi.object({
  providerId: Joi.string().uuid().required(),
  year: Joi.number().integer().min(2020).max(2100).required(),
  week: Joi.number().integer().min(1).max(53).required(),
  sourceYear: Joi.number().integer().min(2020).max(2100).required(),
  sourceWeek: Joi.number().integer().min(1).max(53).required()
});

const slotsQuerySchema = Joi.object({
  providerId: Joi.string().uuid().required(),
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  duration: Joi.number().integer().min(5).max(480).optional().default(30)
});

/**
 * GET /api/v1/availability/:providerId/week/:year/:week
 * Get availability for a specific provider and week
 * Returns specific entry if exists, otherwise template or default
 */
router.get('/:providerId/week/:year/:week', async (req, res) => {
  try {
    const { error, value } = weekParamsSchema.validate({
      providerId: req.params.providerId,
      year: parseInt(req.params.year),
      week: parseInt(req.params.week)
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { providerId, year, week } = value;
    const availabilityService = createAvailabilityService(req.clinicDb);

    const result = await availabilityService.getWeekAvailability(providerId, year, week);

    res.json({
      success: true,
      data: {
        providerId,
        year,
        week,
        ...result
      }
    });
  } catch (error) {
    console.error('[availability] Error getting week availability:', error);

    if (error.message.includes('Provider not found')) {
      return res.status(404).json({
        success: false,
        error: { message: 'Provider not found' }
      });
    }

    res.status(500).json({
      success: false,
      error: { message: 'Failed to get availability', details: error.message }
    });
  }
});

/**
 * PUT /api/v1/availability/:providerId/week/:year/:week
 * Save availability for a specific week
 */
router.put('/:providerId/week/:year/:week', async (req, res) => {
  try {
    // Validate params
    const { error: paramsError, value: params } = weekParamsSchema.validate({
      providerId: req.params.providerId,
      year: parseInt(req.params.year),
      week: parseInt(req.params.week)
    });

    if (paramsError) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: paramsError.details[0].message }
      });
    }

    // Validate body
    const { error: bodyError, value: body } = saveWeekBodySchema.validate(req.body);

    if (bodyError) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: bodyError.details[0].message }
      });
    }

    const { providerId, year, week } = params;
    const { availability, notes } = body;
    const userId = req.user?.id;

    const availabilityService = createAvailabilityService(req.clinicDb);

    const result = await availabilityService.saveWeekAvailability(
      providerId,
      year,
      week,
      availability,
      userId,
      notes
    );

    res.json({
      success: true,
      data: result,
      message: result.created ? 'Availability created' : 'Availability updated'
    });
  } catch (error) {
    console.error('[availability] Error saving week availability:', error);

    res.status(500).json({
      success: false,
      error: { message: 'Failed to save availability', details: error.message }
    });
  }
});

/**
 * POST /api/v1/availability/:providerId/week/:year/:week/copy-from/:sourceYear/:sourceWeek
 * Copy availability from one week to another
 */
router.post('/:providerId/week/:year/:week/copy-from/:sourceYear/:sourceWeek', async (req, res) => {
  try {
    const { error, value } = copyWeekParamsSchema.validate({
      providerId: req.params.providerId,
      year: parseInt(req.params.year),
      week: parseInt(req.params.week),
      sourceYear: parseInt(req.params.sourceYear),
      sourceWeek: parseInt(req.params.sourceWeek)
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { providerId, year, week, sourceYear, sourceWeek } = value;
    const userId = req.user?.id;

    const availabilityService = createAvailabilityService(req.clinicDb);

    const result = await availabilityService.copyWeekAvailability(
      providerId,
      sourceYear,
      sourceWeek,
      year,
      week,
      userId
    );

    res.json({
      success: true,
      data: result,
      message: `Availability copied from week ${sourceWeek}/${sourceYear} to week ${week}/${year}`
    });
  } catch (error) {
    console.error('[availability] Error copying week availability:', error);

    res.status(500).json({
      success: false,
      error: { message: 'Failed to copy availability', details: error.message }
    });
  }
});

/**
 * GET /api/v1/availability/:providerId/template
 * Get provider's default template (from healthcare_providers.availability)
 */
router.get('/:providerId/template', async (req, res) => {
  try {
    const providerId = req.params.providerId;

    if (!providerId || !/^[0-9a-f-]{36}$/i.test(providerId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid provider ID' }
      });
    }

    const availabilityService = createAvailabilityService(req.clinicDb);
    const template = await availabilityService.getProviderTemplate(providerId);

    res.json({
      success: true,
      data: {
        providerId,
        template
      }
    });
  } catch (error) {
    console.error('[availability] Error getting template:', error);

    if (error.message.includes('Provider not found')) {
      return res.status(404).json({
        success: false,
        error: { message: 'Provider not found' }
      });
    }

    res.status(500).json({
      success: false,
      error: { message: 'Failed to get template', details: error.message }
    });
  }
});

/**
 * PUT /api/v1/availability/:providerId/template
 * Save provider's default template
 */
router.put('/:providerId/template', async (req, res) => {
  try {
    const providerId = req.params.providerId;

    if (!providerId || !/^[0-9a-f-]{36}$/i.test(providerId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid provider ID' }
      });
    }

    const { error, value } = Joi.object({
      availability: availabilitySchema.required()
    }).validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const availabilityService = createAvailabilityService(req.clinicDb);
    const template = await availabilityService.saveProviderTemplate(providerId, value.availability);

    res.json({
      success: true,
      data: {
        providerId,
        template
      },
      message: 'Template saved successfully'
    });
  } catch (error) {
    console.error('[availability] Error saving template:', error);

    if (error.message.includes('Provider not found')) {
      return res.status(404).json({
        success: false,
        error: { message: 'Provider not found' }
      });
    }

    res.status(500).json({
      success: false,
      error: { message: 'Failed to save template', details: error.message }
    });
  }
});

/**
 * POST /api/v1/availability/:providerId/apply-template/:year/:week
 * Apply provider's template to a specific week
 */
router.post('/:providerId/apply-template/:year/:week', async (req, res) => {
  try {
    const { error, value } = weekParamsSchema.validate({
      providerId: req.params.providerId,
      year: parseInt(req.params.year),
      week: parseInt(req.params.week)
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { providerId, year, week } = value;
    const userId = req.user?.id;

    const availabilityService = createAvailabilityService(req.clinicDb);
    const result = await availabilityService.applyTemplateToWeek(providerId, year, week, userId);

    res.json({
      success: true,
      data: result,
      message: `Template applied to week ${week}/${year}`
    });
  } catch (error) {
    console.error('[availability] Error applying template:', error);

    res.status(500).json({
      success: false,
      error: { message: 'Failed to apply template', details: error.message }
    });
  }
});

/**
 * GET /api/v1/availability/slots
 * Get available appointment slots for a specific date
 * Query params: providerId, date (YYYY-MM-DD), duration (optional, default 30)
 */
router.get('/slots', async (req, res) => {
  try {
    const { error, value } = slotsQuerySchema.validate(req.query);

    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { providerId, date, duration } = value;

    const availabilityService = createAvailabilityService(req.clinicDb);
    const slots = await availabilityService.getAvailableSlots(providerId, date, duration);

    // Separate available and occupied slots
    const availableSlots = slots.filter(s => s.available);
    const occupiedSlots = slots.filter(s => !s.available);

    res.json({
      success: true,
      data: {
        providerId,
        date,
        duration,
        slots: availableSlots,
        occupiedSlots,
        totalSlots: slots.length,
        availableCount: availableSlots.length
      }
    });
  } catch (error) {
    console.error('[availability] Error getting slots:', error);

    res.status(500).json({
      success: false,
      error: { message: 'Failed to get available slots', details: error.message }
    });
  }
});

/**
 * GET /api/v1/availability/:providerId/effective/:date
 * Get effective availability for a specific day (intersected with clinic hours)
 */
router.get('/:providerId/effective/:date', async (req, res) => {
  try {
    const providerId = req.params.providerId;
    const date = req.params.date;

    if (!providerId || !/^[0-9a-f-]{36}$/i.test(providerId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid provider ID' }
      });
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid date format. Expected YYYY-MM-DD' }
      });
    }

    const availabilityService = createAvailabilityService(req.clinicDb);
    const result = await availabilityService.getEffectiveAvailabilityForDay(providerId, date);

    res.json({
      success: true,
      data: {
        providerId,
        date,
        ...result
      }
    });
  } catch (error) {
    console.error('[availability] Error getting effective availability:', error);

    res.status(500).json({
      success: false,
      error: { message: 'Failed to get effective availability', details: error.message }
    });
  }
});

/**
 * DELETE /api/v1/availability/:providerId/week/:year/:week
 * Delete a specific week's availability (reverts to template)
 */
router.delete('/:providerId/week/:year/:week', async (req, res) => {
  try {
    const { error, value } = weekParamsSchema.validate({
      providerId: req.params.providerId,
      year: parseInt(req.params.year),
      week: parseInt(req.params.week)
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { providerId, year, week } = value;

    const [result] = await req.clinicDb.query(`
      DELETE FROM practitioner_weekly_availability
      WHERE provider_id = :providerId AND year = :year AND week_number = :week
      RETURNING id
    `, {
      replacements: { providerId, year, week }
    });

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'No specific availability found for this week' }
      });
    }

    res.json({
      success: true,
      message: `Week ${week}/${year} availability deleted. Will now use template.`
    });
  } catch (error) {
    console.error('[availability] Error deleting week availability:', error);

    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete availability', details: error.message }
    });
  }
});

module.exports = router;

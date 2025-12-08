/**
 * Clinic Settings Routes
 * Configuration de la clinique : horaires, créneaux, notifications
 */

const express = require('express');
const router = express.Router();
const {
  clinicSettingsSchema,
  updateClinicSettingsSchema
} = require('../base/clinicConfigSchemas');
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

/**
 * GET /api/v1/clinic-settings
 * Get clinic settings (creates default if doesn't exist)
 */
router.get('/', async (req, res) => {
  try {
    // Try to get existing settings
    const [settings] = await req.clinicDb.query(`
      SELECT
        id, facility_id, operating_days, operating_hours, slot_settings,
        closed_dates, appointment_types, notifications,
        created_at, updated_at
      FROM clinic_settings
      WHERE facility_id = :clinicId
    `, { replacements: { clinicId: req.clinicId } });

    if (settings.length === 0) {
      // Create default settings if they don't exist
      console.log('[clinicSettings] No settings found, creating defaults for facility:', req.clinicId);

      const [newSettings] = await req.clinicDb.query(`
        INSERT INTO clinic_settings (facility_id)
        VALUES (:clinicId)
        RETURNING
          id, facility_id, operating_days, operating_hours, slot_settings,
          closed_dates, appointment_types, notifications,
          created_at, updated_at
      `, { replacements: { clinicId: req.clinicId } });

      return res.json({
        success: true,
        data: newSettings[0]
      });
    }

    res.json({
      success: true,
      data: settings[0]
    });
  } catch (error) {
    console.error('[clinicSettings] Error fetching settings:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch clinic settings', details: error.message }
    });
  }
});

/**
 * PUT /api/v1/clinic-settings
 * Update clinic settings
 */
router.put('/', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = updateClinicSettingsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    // Build SET clause dynamically
    const updates = [];
    const replacements = { clinicId: req.clinicId };

    Object.keys(value).forEach(key => {
      updates.push(`${key} = :${key}`);
      replacements[key] = JSON.stringify(value[key]);
    });

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No fields to update' }
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const [result] = await req.clinicDb.query(`
      UPDATE clinic_settings
      SET ${updates.join(', ')}
      WHERE facility_id = :clinicId
      RETURNING
        id, facility_id, operating_days, operating_hours, slot_settings,
        closed_dates, appointment_types, notifications,
        created_at, updated_at
    `, { replacements });

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Clinic settings not found' }
      });
    }

    res.json({
      success: true,
      data: result[0],
      message: 'Clinic settings updated successfully'
    });
  } catch (error) {
    console.error('[clinicSettings] Error updating settings:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update clinic settings', details: error.message }
    });
  }
});

/**
 * POST /api/v1/clinic-settings/closed-dates
 * Add a closed date
 */
router.post('/closed-dates', async (req, res) => {
  try {
    const { date, reason, type = 'other' } = req.body;

    if (!date || !reason) {
      return res.status(400).json({
        success: false,
        error: { message: 'Date and reason are required' }
      });
    }

    // Get current settings
    const [settings] = await req.clinicDb.query(`
      SELECT closed_dates FROM clinic_settings WHERE facility_id = :clinicId
    `, { replacements: { clinicId: req.clinicId } });

    if (settings.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Clinic settings not found' }
      });
    }

    const closedDates = settings[0].closed_dates || [];
    const newClosedDate = {
      id: require('crypto').randomUUID(),
      date,
      reason,
      type
    };

    closedDates.push(newClosedDate);

    // Update settings
    await req.clinicDb.query(`
      UPDATE clinic_settings
      SET closed_dates = :closed_dates, updated_at = CURRENT_TIMESTAMP
      WHERE facility_id = :clinicId
    `, {
      replacements: {
        clinicId: req.clinicId,
        closed_dates: JSON.stringify(closedDates)
      }
    });

    res.json({
      success: true,
      data: newClosedDate,
      message: 'Closed date added successfully'
    });
  } catch (error) {
    console.error('[clinicSettings] Error adding closed date:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to add closed date', details: error.message }
    });
  }
});

/**
 * DELETE /api/v1/clinic-settings/closed-dates/:dateId
 * Remove a closed date
 */
router.delete('/closed-dates/:dateId', async (req, res) => {
  try {
    const { dateId } = req.params;

    // Get current settings
    const [settings] = await req.clinicDb.query(`
      SELECT closed_dates FROM clinic_settings WHERE facility_id = :clinicId
    `, { replacements: { clinicId: req.clinicId } });

    if (settings.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Clinic settings not found' }
      });
    }

    const closedDates = settings[0].closed_dates || [];
    const filteredDates = closedDates.filter(d => d.id !== dateId);

    if (closedDates.length === filteredDates.length) {
      return res.status(404).json({
        success: false,
        error: { message: 'Closed date not found' }
      });
    }

    // Update settings
    await req.clinicDb.query(`
      UPDATE clinic_settings
      SET closed_dates = :closed_dates, updated_at = CURRENT_TIMESTAMP
      WHERE facility_id = :clinicId
    `, {
      replacements: {
        clinicId: req.clinicId,
        closed_dates: JSON.stringify(filteredDates)
      }
    });

    res.json({
      success: true,
      message: 'Closed date removed successfully'
    });
  } catch (error) {
    console.error('[clinicSettings] Error removing closed date:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to remove closed date', details: error.message }
    });
  }
});

module.exports = router;

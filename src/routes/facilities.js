/**
 * Medical Facilities Routes
 * Gestion du profil de l'établissement (company settings)
 */

const express = require('express');
const router = express.Router();
const { updateFacilitySchema } = require('../base/clinicConfigSchemas');
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

/**
 * GET /api/v1/facilities/current
 * Get current facility info (company profile)
 */
router.get('/current', async (req, res) => {
  try {
    const [facilities] = await req.clinicDb.query(`
      SELECT
        id, name, facility_type, finess, siret, adeli, rpps,
        address_line1, address_line2, postal_code, city, country,
        phone, email, website,
        specialties, services, settings,
        timezone, language,
        is_active, subscription_plan, subscription_expires_at,
        created_at, updated_at
      FROM medical_facilities
      WHERE id = :clinicId
    `, { replacements: { clinicId: req.clinicId } });

    if (facilities.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Facility not found' }
      });
    }

    res.json({
      success: true,
      data: facilities[0]
    });
  } catch (error) {
    console.error('[facilities] Error fetching facility:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch facility', details: error.message }
    });
  }
});

/**
 * PUT /api/v1/facilities/current
 * Update current facility (company profile)
 */
router.put('/current', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = updateFacilitySchema.validate(req.body);
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
      if (key === 'specialties' || key === 'services') {
        // Stringify JSONB arrays
        updates.push(`${key} = :${key}`);
        replacements[key] = JSON.stringify(value[key]);
      } else {
        updates.push(`${key} = :${key}`);
        replacements[key] = value[key];
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No fields to update' }
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const [result] = await req.clinicDb.query(`
      UPDATE medical_facilities
      SET ${updates.join(', ')}
      WHERE id = :clinicId
      RETURNING
        id, name, facility_type, finess, siret, adeli, rpps,
        address_line1, address_line2, postal_code, city, country,
        phone, email, website,
        specialties, services,
        timezone, language,
        is_active, created_at, updated_at
    `, { replacements });

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Facility not found' }
      });
    }

    res.json({
      success: true,
      data: result[0],
      message: 'Facility updated successfully'
    });
  } catch (error) {
    console.error('[facilities] Error updating facility:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update facility', details: error.message }
    });
  }
});

module.exports = router;

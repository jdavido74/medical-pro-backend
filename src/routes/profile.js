/**
 * User Profile Routes
 * Handles user profile updates (both central and clinic databases)
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');
const { getCentralConnection } = require('../config/connectionManager');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

/**
 * Profile update schema
 */
const updateProfileSchema = Joi.object({
  first_name: Joi.string().min(2).max(100).optional()
    .messages({
      'string.min': 'Le prénom doit contenir au moins 2 caractères / El nombre debe tener al menos 2 caracteres',
      'string.max': 'Le prénom ne peut pas dépasser 100 caractères / El nombre no puede exceder 100 caracteres'
    }),
  last_name: Joi.string().min(2).max(100).optional()
    .messages({
      'string.min': 'Le nom doit contenir au moins 2 caractères / El apellido debe tener al menos 2 caracteres',
      'string.max': 'Le nom ne peut pas dépasser 100 caractères / El apellido no puede exceder 100 caracteres'
    }),
  email: Joi.string().email().optional()
    .messages({
      'string.email': 'Email invalide / Email inválido'
    })
}).min(1); // At least one field required

/**
 * PUT /api/v1/profile
 * Update user profile in BOTH central and clinic databases
 */
router.put('/', clinicRoutingMiddleware, async (req, res) => {
  try {
    // Validate request
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const userId = req.user.id;
    const updates = [];
    const replacements = { userId };

    // Build dynamic UPDATE clause
    Object.keys(value).forEach(key => {
      updates.push(`${key} = :${key}`);
      replacements[key] = value[key];
    });

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No fields to update' }
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    // 1. Update CENTRAL database (users table)
    console.log('[profile] Updating central database for user:', userId);
    const centralDb = getCentralConnection();
    const [centralResult] = await centralDb.query(`
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = :userId
      RETURNING id, email, first_name, last_name, role, company_id
    `, { replacements });

    if (centralResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found in central database' }
      });
    }

    // 2. Update CLINIC database (healthcare_providers table) if exists
    let clinicResult = null;
    if (req.clinicDb) {
      console.log('[profile] Updating clinic database for user:', userId);
      try {
        const [result] = await req.clinicDb.query(`
          UPDATE healthcare_providers
          SET ${updates.join(', ')}
          WHERE id = :userId
          RETURNING id, email, first_name, last_name, role, profession
        `, { replacements });

        clinicResult = result[0] || null;
      } catch (clinicError) {
        // If user doesn't exist in clinic DB (admin-only account), it's ok
        console.log('[profile] User not in clinic database (admin-only account)');
      }
    }

    console.log(`[profile] ✅ Profile updated successfully for user: ${userId}`);

    // Return updated user data
    res.json({
      success: true,
      data: {
        central: centralResult[0],
        clinic: clinicResult
      },
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('[profile] Error updating profile:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update profile', details: error.message }
    });
  }
});

module.exports = router;

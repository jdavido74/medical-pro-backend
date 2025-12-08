/**
 * Healthcare Providers Routes
 * Gestion des utilisateurs de la clinique (praticiens, infirmiers, secrétaires, etc.)
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const {
  createHealthcareProviderSchema,
  updateHealthcareProviderSchema,
  queryParamsSchema
} = require('../base/clinicConfigSchemas');
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

/**
 * GET /api/v1/healthcare-providers
 * List all healthcare providers for the clinic
 */
router.get('/', async (req, res) => {
  try {
    const { error, value } = queryParamsSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { page = 1, limit = 100, search = '', role, is_active } = value;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereConditions = [];
    const replacements = { limit, offset };

    if (search) {
      whereConditions.push(`(
        first_name ILIKE :search OR
        last_name ILIKE :search OR
        email ILIKE :search OR
        profession ILIKE :search
      )`);
      replacements.search = `%${search}%`;
    }

    if (role) {
      whereConditions.push('role = :role');
      replacements.role = role;
    }

    if (is_active !== undefined) {
      whereConditions.push('is_active = :is_active');
      replacements.is_active = is_active;
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Query providers
    const [providers] = await req.clinicDb.query(`
      SELECT
        id, facility_id, email, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        is_active, email_verified, last_login, created_at, updated_at
      FROM healthcare_providers
      ${whereClause}
      ORDER BY last_name, first_name
      LIMIT :limit OFFSET :offset
    `, { replacements });

    // Count total
    const [countResult] = await req.clinicDb.query(`
      SELECT COUNT(*) as total
      FROM healthcare_providers
      ${whereClause}
    `, { replacements: { ...replacements, limit: undefined, offset: undefined } });

    const total = parseInt(countResult[0].total);

    res.json({
      success: true,
      data: providers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('[healthcareProviders] Error fetching providers:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch healthcare providers', details: error.message }
    });
  }
});

/**
 * GET /api/v1/healthcare-providers/:id
 * Get single healthcare provider
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [providers] = await req.clinicDb.query(`
      SELECT
        id, facility_id, email, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        is_active, email_verified, last_login, created_at, updated_at
      FROM healthcare_providers
      WHERE id = :id
    `, { replacements: { id } });

    if (providers.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Healthcare provider not found' }
      });
    }

    res.json({
      success: true,
      data: providers[0]
    });
  } catch (error) {
    console.error('[healthcareProviders] Error fetching provider:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch healthcare provider', details: error.message }
    });
  }
});

/**
 * POST /api/v1/healthcare-providers
 * Create new healthcare provider
 */
router.post('/', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = createHealthcareProviderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(value.password_hash, 10);

    // Insert provider (use req.clinicId from auth context, not from request body)
    const [result] = await req.clinicDb.query(`
      INSERT INTO healthcare_providers (
        facility_id, email, password_hash, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        is_active, email_verified
      ) VALUES (
        :facility_id, :email, :password_hash, :first_name, :last_name, :title,
        :profession, :specialties, :adeli, :rpps, :order_number,
        :role, :permissions, :phone, :mobile, :availability, :color,
        :is_active, :email_verified
      ) RETURNING
        id, facility_id, email, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        is_active, email_verified, created_at, updated_at
    `, {
      replacements: {
        ...value,
        facility_id: req.clinicId,  // Use clinic ID from authentication context
        password_hash: hashedPassword,
        specialties: JSON.stringify(value.specialties || []),
        permissions: JSON.stringify(value.permissions || {}),
        availability: JSON.stringify(value.availability || {})
      }
    });

    res.status(201).json({
      success: true,
      data: result[0],
      message: 'Healthcare provider created successfully'
    });
  } catch (error) {
    console.error('[healthcareProviders] Error creating provider:', error);

    if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
      return res.status(409).json({
        success: false,
        error: { message: 'Email already exists' }
      });
    }

    res.status(500).json({
      success: false,
      error: { message: 'Failed to create healthcare provider', details: error.message }
    });
  }
});

/**
 * PUT /api/v1/healthcare-providers/:id
 * Update healthcare provider
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate request body
    const { error, value } = updateHealthcareProviderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    // Build SET clause dynamically
    const updates = [];
    const replacements = { id };

    Object.keys(value).forEach(key => {
      if (key === 'password_hash' && value[key]) {
        // Hash password if provided
        updates.push(`${key} = :${key}`);
        replacements[key] = bcrypt.hashSync(value[key], 10);
      } else if (key === 'specialties' || key === 'permissions' || key === 'availability') {
        // Stringify JSONB fields
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
      UPDATE healthcare_providers
      SET ${updates.join(', ')}
      WHERE id = :id
      RETURNING
        id, facility_id, email, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        is_active, email_verified, last_login, created_at, updated_at
    `, { replacements });

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Healthcare provider not found' }
      });
    }

    res.json({
      success: true,
      data: result[0],
      message: 'Healthcare provider updated successfully'
    });
  } catch (error) {
    console.error('[healthcareProviders] Error updating provider:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update healthcare provider', details: error.message }
    });
  }
});

/**
 * DELETE /api/v1/healthcare-providers/:id
 * Delete (deactivate) healthcare provider
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await req.clinicDb.query(`
      UPDATE healthcare_providers
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
      RETURNING
        id, facility_id, email, first_name, last_name, role, is_active
    `, { replacements: { id } });

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Healthcare provider not found' }
      });
    }

    res.json({
      success: true,
      data: result[0],
      message: 'Healthcare provider deactivated successfully'
    });
  } catch (error) {
    console.error('[healthcareProviders] Error deleting provider:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete healthcare provider', details: error.message }
    });
  }
});

module.exports = router;

/**
 * Clinic Roles Routes
 * Gestion des rôles personnalisés pour la clinique
 */

const express = require('express');
const router = express.Router();
const {
  createClinicRoleSchema,
  updateClinicRoleSchema,
  queryParamsSchema
} = require('../base/clinicConfigSchemas');
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

/**
 * GET /api/v1/clinic-roles
 * List all roles for the clinic
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

    const { page = 1, limit = 100, search = '' } = value;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereConditions = ['facility_id = :clinicId'];
    const replacements = { clinicId: req.clinicId, limit, offset };

    if (search) {
      whereConditions.push('(name ILIKE :search OR description ILIKE :search)');
      replacements.search = `%${search}%`;
    }

    const whereClause = whereConditions.join(' AND ');

    // Query roles
    const [roles] = await req.clinicDb.query(`
      SELECT
        id, facility_id, name, description, level, is_system_role,
        permissions, color, created_at, updated_at
      FROM clinic_roles
      WHERE ${whereClause}
      ORDER BY level DESC, name
      LIMIT :limit OFFSET :offset
    `, { replacements });

    // Count total
    const [countResult] = await req.clinicDb.query(`
      SELECT COUNT(*) as total
      FROM clinic_roles
      WHERE ${whereClause}
    `, { replacements: { ...replacements, limit: undefined, offset: undefined } });

    const total = parseInt(countResult[0].total);

    res.json({
      success: true,
      data: roles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('[clinicRoles] Error fetching roles:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch clinic roles', details: error.message }
    });
  }
});

/**
 * Helper: Check if string is a valid UUID
 */
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * GET /api/v1/clinic-roles/:id
 * Get single role by ID (UUID) or name (for system roles like 'admin', 'physician')
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Search by UUID or by name (for system roles)
    const whereClause = isValidUUID(id)
      ? 'id = :id'
      : 'name = :id';

    const [roles] = await req.clinicDb.query(`
      SELECT
        id, facility_id, name, description, level, is_system_role,
        permissions, color, created_at, updated_at
      FROM clinic_roles
      WHERE ${whereClause} AND facility_id = :clinicId
    `, { replacements: { id, clinicId: req.clinicId } });

    if (roles.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Role not found' }
      });
    }

    res.json({
      success: true,
      data: roles[0]
    });
  } catch (error) {
    console.error('[clinicRoles] Error fetching role:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch role', details: error.message }
    });
  }
});

/**
 * POST /api/v1/clinic-roles
 * Create new role
 */
router.post('/', async (req, res) => {
  try {
    // Force facility_id to current clinic
    const bodyWithFacility = {
      ...req.body,
      facility_id: req.clinicId
    };

    // Validate request body
    const { error, value } = createClinicRoleSchema.validate(bodyWithFacility);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    // Insert role
    const [result] = await req.clinicDb.query(`
      INSERT INTO clinic_roles (
        facility_id, name, description, level, is_system_role,
        permissions, color
      ) VALUES (
        :facility_id, :name, :description, :level, :is_system_role,
        :permissions, :color
      ) RETURNING
        id, facility_id, name, description, level, is_system_role,
        permissions, color, created_at, updated_at
    `, {
      replacements: {
        ...value,
        permissions: JSON.stringify(value.permissions || [])
      }
    });

    res.status(201).json({
      success: true,
      data: result[0],
      message: 'Role created successfully'
    });
  } catch (error) {
    console.error('[clinicRoles] Error creating role:', error);

    if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
      return res.status(409).json({
        success: false,
        error: { message: 'A role with this name already exists' }
      });
    }

    res.status(500).json({
      success: false,
      error: { message: 'Failed to create role', details: error.message }
    });
  }
});

/**
 * PUT /api/v1/clinic-roles/:id
 * Update role (supports UUID or name for system roles)
 * System roles: only permissions can be modified
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Search by UUID or by name (for system roles)
    const whereClause = isValidUUID(id)
      ? 'id = :id'
      : 'name = :id';

    // Check if role belongs to this clinic
    const [existing] = await req.clinicDb.query(`
      SELECT id, is_system_role, name FROM clinic_roles
      WHERE ${whereClause} AND facility_id = :clinicId
    `, { replacements: { id, clinicId: req.clinicId } });

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Role not found' }
      });
    }

    const roleRecord = existing[0];
    const actualId = roleRecord.id; // Use the actual UUID for update

    // Validate request body
    const { error, value } = updateClinicRoleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    // For system roles, only allow updating permissions
    if (roleRecord.is_system_role) {
      const allowedFields = ['permissions'];
      const attemptedFields = Object.keys(value);
      const forbiddenFields = attemptedFields.filter(f => !allowedFields.includes(f));

      if (forbiddenFields.length > 0) {
        console.log(`[clinicRoles] System role ${roleRecord.name}: ignoring non-permission fields: ${forbiddenFields.join(', ')}`);
        // Remove non-permission fields silently (don't error, just ignore)
        forbiddenFields.forEach(f => delete value[f]);
      }

      if (Object.keys(value).length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'System roles: only permissions can be modified' }
        });
      }
    }

    // Build SET clause dynamically
    const updates = [];
    const replacements = { actualId, clinicId: req.clinicId };

    Object.keys(value).forEach(key => {
      if (key === 'permissions') {
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
      UPDATE clinic_roles
      SET ${updates.join(', ')}
      WHERE id = :actualId AND facility_id = :clinicId
      RETURNING
        id, facility_id, name, description, level, is_system_role,
        permissions, color, created_at, updated_at
    `, { replacements });

    res.json({
      success: true,
      data: result[0],
      message: 'Role updated successfully'
    });
  } catch (error) {
    console.error('[clinicRoles] Error updating role:', error);

    if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
      return res.status(409).json({
        success: false,
        error: { message: 'A role with this name already exists' }
      });
    }

    res.status(500).json({
      success: false,
      error: { message: 'Failed to update role', details: error.message }
    });
  }
});

/**
 * DELETE /api/v1/clinic-roles/:id
 * Delete role (only custom roles, not system roles)
 * Supports UUID or name for lookup
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Search by UUID or by name
    const whereClause = isValidUUID(id)
      ? 'id = :id'
      : 'name = :id';

    // Check if role is system role
    const [existing] = await req.clinicDb.query(`
      SELECT id, is_system_role, name FROM clinic_roles
      WHERE ${whereClause} AND facility_id = :clinicId
    `, { replacements: { id, clinicId: req.clinicId } });

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Role not found' }
      });
    }

    const roleRecord = existing[0];

    if (roleRecord.is_system_role) {
      return res.status(403).json({
        success: false,
        error: { message: 'Cannot delete system roles' }
      });
    }

    // Delete role using actual UUID
    await req.clinicDb.query(`
      DELETE FROM clinic_roles
      WHERE id = :actualId AND facility_id = :clinicId
    `, { replacements: { actualId: roleRecord.id, clinicId: req.clinicId } });

    res.json({
      success: true,
      message: 'Role deleted successfully'
    });
  } catch (error) {
    console.error('[clinicRoles] Error deleting role:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete role', details: error.message }
    });
  }
});

module.exports = router;

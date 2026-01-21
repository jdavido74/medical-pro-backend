/**
 * Teams Routes
 * Gestion des équipes de la clinique
 *
 * Les équipes permettent d'organiser les praticiens par service ou spécialité.
 * Utilisé notamment dans l'onboarding pour créer la première équipe.
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');
const { logger } = require('../utils/logger');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

// Validation schemas
const createTeamSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(500).allow('', null),
  department: Joi.string().max(100).allow('', null),
  specialties: Joi.array().items(Joi.string()).default([]),
  is_active: Joi.boolean().default(true)
});

const updateTeamSchema = Joi.object({
  name: Joi.string().min(2).max(100),
  description: Joi.string().max(500).allow('', null),
  department: Joi.string().max(100).allow('', null),
  specialties: Joi.array().items(Joi.string()),
  is_active: Joi.boolean()
}).min(1);

const queryParamsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  search: Joi.string().allow(''),
  department: Joi.string().allow(''),
  is_active: Joi.boolean()
});

/**
 * GET /api/v1/teams
 * List all teams for the clinic
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

    const { page = 1, limit = 50, search = '', department, is_active } = value;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereConditions = [];
    const replacements = { limit, offset };

    if (search) {
      whereConditions.push(`(
        name ILIKE :search OR
        description ILIKE :search OR
        department ILIKE :search
      )`);
      replacements.search = `%${search}%`;
    }

    if (department) {
      whereConditions.push('department = :department');
      replacements.department = department;
    }

    if (is_active !== undefined) {
      whereConditions.push('is_active = :is_active');
      replacements.is_active = is_active;
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Query teams with member count
    const [teams] = await req.clinicDb.query(`
      SELECT
        t.id, t.name, t.description, t.department, t.specialties,
        t.is_active, t.created_at, t.updated_at,
        COALESCE(COUNT(hp.id), 0)::integer as member_count
      FROM teams t
      LEFT JOIN healthcare_providers hp ON hp.team_id = t.id AND hp.is_active = true
      ${whereClause.replace(/WHERE/g, 'WHERE t.')}
      GROUP BY t.id, t.name, t.description, t.department, t.specialties, t.is_active, t.created_at, t.updated_at
      ORDER BY t.name
      LIMIT :limit OFFSET :offset
    `, { replacements });

    // Count total
    const [countResult] = await req.clinicDb.query(`
      SELECT COUNT(*) as total
      FROM teams
      ${whereClause}
    `, { replacements: { ...replacements, limit: undefined, offset: undefined } });

    const total = parseInt(countResult[0].total);

    res.json({
      success: true,
      data: teams,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('[teams] Error listing teams:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to list teams', details: error.message }
    });
  }
});

/**
 * GET /api/v1/teams/:id
 * Get a single team by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [teams] = await req.clinicDb.query(`
      SELECT
        t.id, t.name, t.description, t.department, t.specialties,
        t.is_active, t.created_at, t.updated_at,
        COALESCE(COUNT(hp.id), 0)::integer as member_count
      FROM teams t
      LEFT JOIN healthcare_providers hp ON hp.team_id = t.id AND hp.is_active = true
      WHERE t.id = :id
      GROUP BY t.id, t.name, t.description, t.department, t.specialties, t.is_active, t.created_at, t.updated_at
    `, { replacements: { id } });

    if (teams.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Team not found' }
      });
    }

    res.json({
      success: true,
      data: teams[0]
    });

  } catch (error) {
    logger.error('[teams] Error getting team:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get team', details: error.message }
    });
  }
});

/**
 * POST /api/v1/teams
 * Create a new team
 */
router.post('/', async (req, res) => {
  try {
    const { error, value } = createTeamSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { name, description, department, specialties, is_active } = value;

    // Check if team with same name already exists
    const [existing] = await req.clinicDb.query(`
      SELECT id FROM teams WHERE name = :name
    `, { replacements: { name } });

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: { message: 'A team with this name already exists' }
      });
    }

    // Insert new team
    const [result] = await req.clinicDb.query(`
      INSERT INTO teams (name, description, department, specialties, is_active, created_at, updated_at)
      VALUES (:name, :description, :department, :specialties, :is_active, NOW(), NOW())
      RETURNING id, name, description, department, specialties, is_active, created_at, updated_at
    `, {
      replacements: {
        name,
        description: description || null,
        department: department || null,
        specialties: JSON.stringify(specialties || []),
        is_active: is_active !== false
      }
    });

    logger.info(`[teams] Team created: ${name}`, {
      teamId: result[0].id,
      userId: req.user.id,
      clinicId: req.clinicId
    });

    res.status(201).json({
      success: true,
      data: result[0]
    });

  } catch (error) {
    logger.error('[teams] Error creating team:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create team', details: error.message }
    });
  }
});

/**
 * PUT /api/v1/teams/:id
 * Update an existing team
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error, value } = updateTeamSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    // Check if team exists
    const [existing] = await req.clinicDb.query(`
      SELECT id FROM teams WHERE id = :id
    `, { replacements: { id } });

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Team not found' }
      });
    }

    // Build update query
    const updates = [];
    const replacements = { id };

    if (value.name !== undefined) {
      updates.push('name = :name');
      replacements.name = value.name;
    }
    if (value.description !== undefined) {
      updates.push('description = :description');
      replacements.description = value.description;
    }
    if (value.department !== undefined) {
      updates.push('department = :department');
      replacements.department = value.department;
    }
    if (value.specialties !== undefined) {
      updates.push('specialties = :specialties');
      replacements.specialties = JSON.stringify(value.specialties);
    }
    if (value.is_active !== undefined) {
      updates.push('is_active = :is_active');
      replacements.is_active = value.is_active;
    }

    updates.push('updated_at = NOW()');

    const [result] = await req.clinicDb.query(`
      UPDATE teams
      SET ${updates.join(', ')}
      WHERE id = :id
      RETURNING id, name, description, department, specialties, is_active, created_at, updated_at
    `, { replacements });

    logger.info(`[teams] Team updated: ${id}`, {
      teamId: id,
      userId: req.user.id,
      clinicId: req.clinicId
    });

    res.json({
      success: true,
      data: result[0]
    });

  } catch (error) {
    logger.error('[teams] Error updating team:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update team', details: error.message }
    });
  }
});

/**
 * DELETE /api/v1/teams/:id
 * Delete (soft-delete) a team
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if team exists
    const [existing] = await req.clinicDb.query(`
      SELECT id, name FROM teams WHERE id = :id
    `, { replacements: { id } });

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Team not found' }
      });
    }

    // Soft delete (set is_active to false)
    await req.clinicDb.query(`
      UPDATE teams
      SET is_active = false, updated_at = NOW()
      WHERE id = :id
    `, { replacements: { id } });

    logger.info(`[teams] Team deleted (soft): ${existing[0].name}`, {
      teamId: id,
      userId: req.user.id,
      clinicId: req.clinicId
    });

    res.json({
      success: true,
      data: { id, deleted: true }
    });

  } catch (error) {
    logger.error('[teams] Error deleting team:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete team', details: error.message }
    });
  }
});

module.exports = router;

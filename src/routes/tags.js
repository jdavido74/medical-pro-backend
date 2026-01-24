/**
 * Tags Routes - Clinic Isolated
 * CRUD operations for product tags with clinic-specific database isolation
 */

const express = require('express');
const Joi = require('joi');
const { getModel } = require('../base/ModelFactory');

const router = express.Router();

// Validation schemas
const createSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#6366F1'),
  description: Joi.string().allow('', null).optional()
});

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
  description: Joi.string().allow('', null).optional()
});

/**
 * GET /tags - Get all tags
 */
router.get('/', async (req, res) => {
  try {
    const Tag = await getModel(req.clinicDb, 'Tag');

    const tags = await Tag.findAll({
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      data: tags.map(tag => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        description: tag.description,
        createdAt: tag.created_at,
        updatedAt: tag.updated_at
      }))
    });
  } catch (error) {
    console.error('[tags] Error fetching tags:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch tags' }
    });
  }
});

/**
 * GET /tags/:id - Get a single tag with its products
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const Tag = await getModel(req.clinicDb, 'Tag');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const tag = await Tag.findByPk(id, {
      include: [{
        model: ProductService,
        as: 'products',
        through: { attributes: [] }
      }]
    });

    if (!tag) {
      return res.status(404).json({
        success: false,
        error: { message: 'Tag not found' }
      });
    }

    res.json({
      success: true,
      data: {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        description: tag.description,
        products: tag.products?.map(p => ({
          id: p.id,
          title: p.title,
          itemType: p.item_type,
          unitPrice: parseFloat(p.unit_price)
        })) || [],
        createdAt: tag.created_at,
        updatedAt: tag.updated_at
      }
    });
  } catch (error) {
    console.error('[tags] Error fetching tag:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch tag' }
    });
  }
});

/**
 * POST /tags - Create a new tag
 */
router.post('/', async (req, res) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const Tag = await getModel(req.clinicDb, 'Tag');

    // Check for duplicate name
    const existing = await Tag.findOne({ where: { name: value.name } });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: { message: 'A tag with this name already exists' }
      });
    }

    const tag = await Tag.create({
      name: value.name,
      color: value.color,
      description: value.description,
      company_id: req.user.companyId
    });

    res.status(201).json({
      success: true,
      data: {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        description: tag.description,
        createdAt: tag.created_at,
        updatedAt: tag.updated_at
      }
    });
  } catch (error) {
    console.error('[tags] Error creating tag:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create tag' }
    });
  }
});

/**
 * PUT /tags/:id - Update a tag
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error, value } = updateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }

    const Tag = await getModel(req.clinicDb, 'Tag');

    const tag = await Tag.findByPk(id);
    if (!tag) {
      return res.status(404).json({
        success: false,
        error: { message: 'Tag not found' }
      });
    }

    // Check for duplicate name if name is being changed
    if (value.name && value.name !== tag.name) {
      const existing = await Tag.findOne({ where: { name: value.name } });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: { message: 'A tag with this name already exists' }
        });
      }
    }

    await tag.update(value);

    res.json({
      success: true,
      data: {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        description: tag.description,
        createdAt: tag.created_at,
        updatedAt: tag.updated_at
      }
    });
  } catch (error) {
    console.error('[tags] Error updating tag:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update tag' }
    });
  }
});

/**
 * DELETE /tags/:id - Delete a tag
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const Tag = await getModel(req.clinicDb, 'Tag');

    const tag = await Tag.findByPk(id);
    if (!tag) {
      return res.status(404).json({
        success: false,
        error: { message: 'Tag not found' }
      });
    }

    await tag.destroy();

    res.json({
      success: true,
      message: 'Tag deleted successfully'
    });
  } catch (error) {
    console.error('[tags] Error deleting tag:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete tag' }
    });
  }
});

module.exports = router;

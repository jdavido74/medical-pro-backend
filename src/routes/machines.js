/**
 * Machines Routes
 * CRUD operations for machine management with treatment assignments
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const { getModel } = require('../base/ModelFactory');

// Validation schemas
const createSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().allow('', null).optional(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6'),
  location: Joi.string().max(200).allow('', null).optional(),
  isActive: Joi.boolean().default(true),
  treatments: Joi.array().items(Joi.string().uuid()).optional()
});

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  description: Joi.string().allow('', null).optional(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
  location: Joi.string().max(200).allow('', null).optional(),
  isActive: Joi.boolean().optional(),
  treatments: Joi.array().items(Joi.string().uuid()).optional()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  search: Joi.string().optional(),
  isActive: Joi.boolean().optional()
});

// Field mapping camelCase → snake_case
const fieldMapping = {
  isActive: 'is_active',
  companyId: 'company_id'
};

// Transform camelCase to snake_case for database
const transformToDb = (data) => {
  const transformed = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'treatments') continue; // Handle separately
    const dbKey = fieldMapping[key] || key;
    transformed[dbKey] = value;
  }
  return transformed;
};

// Transform snake_case to camelCase for API response
const transformFromDb = (item) => {
  if (!item) return null;
  const data = item.toJSON ? item.toJSON() : item;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    color: data.color,
    location: data.location,
    isActive: data.is_active,
    companyId: data.company_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    // Include treatments if loaded
    treatments: data.treatments ? data.treatments.map(t => ({
      id: t.id,
      title: t.title,
      itemType: t.item_type,
      duration: t.duration
    })) : undefined
  };
};

// Basic CRUD routes
const machineRoutes = clinicCrudRoutes('Machine', {
  createSchema,
  updateSchema,
  querySchema,
  displayName: 'Machine',
  searchFields: ['name', 'description', 'location'],

  permissions: {
    view: 'machines.view',
    create: 'machines.create',
    update: 'machines.edit',
    delete: 'machines.delete'
  },

  onBeforeCreate: async (data, user, clinicDb) => {
    const dbData = transformToDb(data);
    dbData.company_id = user.companyId;

    // Store treatment IDs for after create
    dbData._treatmentIds = data.treatments || [];

    return dbData;
  },

  onAfterCreate: async (item, data, user, clinicDb) => {
    const treatmentIds = data._treatmentIds || [];
    if (treatmentIds.length > 0) {
      try {
        const ProductService = await getModel(clinicDb, 'ProductService');
        const treatments = await ProductService.findAll({
          where: { id: treatmentIds }
        });
        if (treatments.length > 0) {
          await item.setTreatments(treatments);
        }
      } catch (error) {
        console.error('[machines] Error setting treatments:', error);
      }
    }
  },

  onBeforeUpdate: async (data, existingItem, user, clinicDb) => {
    const dbData = transformToDb(data);

    // Handle treatments update
    if (data.treatments !== undefined) {
      try {
        const ProductService = await getModel(clinicDb, 'ProductService');
        const treatments = await ProductService.findAll({
          where: { id: data.treatments || [] }
        });
        await existingItem.setTreatments(treatments);
      } catch (error) {
        console.error('[machines] Error updating treatments:', error);
      }
    }

    return dbData;
  },

  // Include treatments when building query
  buildQuery: async (query, queryParams, clinicDb) => {
    try {
      // Ensure Machine model is loaded first to set up associations
      const Machine = await getModel(clinicDb, 'Machine');
      const ProductService = await getModel(clinicDb, 'ProductService');

      query.include = query.include || [];

      // Add treatments include only if association exists
      if (Machine.associations?.treatments) {
        query.include.push({
          model: ProductService,
          as: 'treatments',
          through: { attributes: [] },
          attributes: ['id', 'title', 'item_type', 'duration', 'is_active'],
          required: false
        });
      } else {
        console.warn('[machines] treatments association not found on Machine model');
      }
    } catch (err) {
      console.error('[machines] Error in buildQuery:', err.message);
    }

    return query;
  },

  transformResponse: (item) => transformFromDb(item)
});

// === Custom endpoints (MUST be defined BEFORE CRUD routes) ===

/**
 * GET /machines/available-treatments - Get treatments that require machines
 */
router.get('/available-treatments', async (req, res) => {
  try {
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    // Get treatments that are not overlappable (require machine)
    const treatments = await ProductService.findAll({
      where: {
        item_type: 'treatment',
        is_active: true,
        is_overlappable: false
      },
      attributes: ['id', 'title', 'description', 'duration', 'item_type'],
      order: [['title', 'ASC']]
    });

    res.json({
      success: true,
      data: treatments.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        duration: t.duration,
        itemType: t.item_type
      }))
    });
  } catch (error) {
    console.error('[machines] Error fetching available treatments:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch treatments' }
    });
  }
});

/**
 * GET /machines/by-treatment/:treatmentId - Get machines that can perform a treatment
 */
router.get('/by-treatment/:treatmentId', async (req, res) => {
  try {
    const { treatmentId } = req.params;

    const Machine = await getModel(req.clinicDb, 'Machine');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const machines = await Machine.findAll({
      where: { is_active: true },
      include: [{
        model: ProductService,
        as: 'treatments',
        through: { attributes: [] },
        where: { id: treatmentId },
        required: true
      }]
    });

    res.json({
      success: true,
      data: machines.map(m => ({
        id: m.id,
        name: m.name,
        color: m.color,
        location: m.location,
        isActive: m.is_active
      })),
      count: machines.length
    });
  } catch (error) {
    console.error('[machines] Error fetching machines by treatment:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch machines' }
    });
  }
});

// Mount CRUD routes AFTER custom routes
router.use('/', machineRoutes);

// === Routes with :id parameter (after CRUD) ===

/**
 * POST /machines/:id/treatments - Assign treatments to a machine (bulk)
 */
router.post('/:id/treatments', async (req, res) => {
  try {
    const { id } = req.params;
    const { treatmentIds } = req.body;

    if (!Array.isArray(treatmentIds)) {
      return res.status(400).json({
        success: false,
        error: { message: 'treatmentIds must be an array' }
      });
    }

    const Machine = await getModel(req.clinicDb, 'Machine');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const machine = await Machine.findByPk(id);
    if (!machine) {
      return res.status(404).json({
        success: false,
        error: { message: 'Machine not found' }
      });
    }

    // Get treatments (only treatments, not other product types)
    const treatments = await ProductService.findAll({
      where: {
        id: treatmentIds,
        item_type: 'treatment'
      }
    });

    await machine.setTreatments(treatments);

    // Reload with treatments
    await machine.reload({
      include: [{
        model: ProductService,
        as: 'treatments',
        through: { attributes: [] }
      }]
    });

    res.json({
      success: true,
      data: transformFromDb(machine),
      message: `${treatments.length} treatment(s) assigned to machine`
    });
  } catch (error) {
    console.error('[machines] Error assigning treatments:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to assign treatments' }
    });
  }
});

/**
 * GET /machines/:id/treatments - Get treatments for a machine
 */
router.get('/:id/treatments', async (req, res) => {
  try {
    const { id } = req.params;

    const Machine = await getModel(req.clinicDb, 'Machine');
    const ProductService = await getModel(req.clinicDb, 'ProductService');

    const machine = await Machine.findByPk(id, {
      include: [{
        model: ProductService,
        as: 'treatments',
        through: { attributes: [] },
        where: { is_active: true },
        required: false
      }]
    });

    if (!machine) {
      return res.status(404).json({
        success: false,
        error: { message: 'Machine not found' }
      });
    }

    res.json({
      success: true,
      data: machine.treatments.map(t => ({
        id: t.id,
        title: t.title,
        itemType: t.item_type,
        duration: t.duration,
        isActive: t.is_active
      }))
    });
  } catch (error) {
    console.error('[machines] Error fetching treatments:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch treatments' }
    });
  }
});

module.exports = router;

/**
 * Clinic-Aware CRUD Routes Factory
 *
 * Purpose: Generate CRUD routes that work with clinic-specific databases
 * Each route automatically gets the model from req.clinicDb via ModelFactory
 *
 * Usage:
 * const clinicCrudRoutes = require('./clinicCrudRoutes');
 * const patientRoutes = clinicCrudRoutes('Patient', {
 *   createSchema: createPatientSchema,
 *   updateSchema: updatePatientSchema,
 *   querySchema: querySchema,
 *   modelName: 'Patient',
 *   searchFields: ['first_name', 'last_name', 'email']
 * });
 * router.use('/patients', patientRoutes);
 *
 * Key Difference from crudRoutes:
 * - Takes model NAME (string) instead of model class
 * - Each route fetches the model from req.clinicDb
 * - All queries automatically isolated to clinic database
 */

const express = require('express');
const { logger } = require('../utils/logger');
const { Op } = require('sequelize');
const { getModel } = require('./ModelFactory');

function createClinicCrudRoutes(modelName, config = {}) {
  const router = express.Router();

  const {
    createSchema,
    updateSchema,
    querySchema,
    displayName = modelName,
    searchFields = ['name', 'email'],
    onBeforeCreate = null,
    onBeforeUpdate = null,
    onAfterCreate = null,
    onAfterUpdate = null,
    onAfterDelete = null
  } = config;

  /**
   * GET /
   * Retrieve all records with pagination (clinic-isolated)
   */
  router.get('/', async (req, res, next) => {
    try {
      // Validate parameters
      let params = { page: 1, limit: 20, ...req.query };
      if (querySchema) {
        const { error, value } = querySchema.validate(params);
        if (error) {
          return res.status(400).json({
            success: false,
            error: {
              message: 'Validation Error',
              details: error.details.map(d => d.message).join(', ')
            }
          });
        }
        params = value;
      }

      const { page, limit, search, ...filters } = params;

      // Get clinic-specific model
      const Model = await getModel(req.clinicDb, modelName);

      // Build where clause - NO company_id needed (DB is already isolated!)
      const where = { ...filters, deletedAt: null };

      // Add search if provided
      if (search && searchFields.length > 0) {
        where[Op.or] = searchFields.map(field => ({
          [field]: { [Op.iLike]: `%${search}%` }
        }));
      }

      // Retrieve with pagination
      const offset = (page - 1) * limit;
      const { count, rows } = await Model.findAndCountAll({
        where,
        limit,
        offset,
        order: [['createdAt', 'DESC']],
        subQuery: false
      });

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit),
          hasNextPage: page < Math.ceil(count / limit),
          hasPrevPage: page > 1
        }
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /:id
   * Retrieve single record by ID (clinic-isolated)
   */
  router.get('/:id', async (req, res, next) => {
    try {
      const Model = await getModel(req.clinicDb, modelName);

      const item = await Model.findByPk(req.params.id, {
        where: { deletedAt: null }
      });

      if (!item) {
        return res.status(404).json({
          success: false,
          error: {
            message: `${displayName} not found`,
            details: `No ${displayName} found with this ID`
          }
        });
      }

      res.json({
        success: true,
        data: item
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /
   * Create new record (clinic-isolated)
   */
  router.post('/', async (req, res, next) => {
    try {
      // Validate data
      let validatedData = req.body;
      if (createSchema) {
        const { error, value } = createSchema.validate(req.body);
        if (error) {
          return res.status(400).json({
            success: false,
            error: {
              message: 'Validation Error',
              details: error.details.map(d => d.message).join(', ')
            }
          });
        }
        validatedData = value;
      }

      // Hook before create
      if (onBeforeCreate) {
        validatedData = await onBeforeCreate(validatedData, req.user, req.clinicDb);
      }

      // Get clinic-specific model
      const Model = await getModel(req.clinicDb, modelName);

      // Create
      const item = await Model.create(validatedData);

      // Hook after create
      if (onAfterCreate) {
        await onAfterCreate(item, req.user, req.clinicDb);
      }

      logger.info(`${modelName} created`, {
        id: item.id,
        clinicId: req.clinicId,
        userId: req.user.id
      });

      res.status(201).json({
        success: true,
        data: item,
        message: `${displayName} created successfully`
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PUT /:id
   * Update record (clinic-isolated)
   */
  router.put('/:id', async (req, res, next) => {
    try {
      // Get clinic-specific model
      const Model = await getModel(req.clinicDb, modelName);

      // Check that record exists
      const item = await Model.findByPk(req.params.id, {
        where: { deletedAt: null }
      });

      if (!item) {
        return res.status(404).json({
          success: false,
          error: {
            message: `${displayName} not found`,
            details: `No ${displayName} found with this ID`
          }
        });
      }

      // Validate data
      let updateData = req.body;
      if (updateSchema) {
        const { error, value } = updateSchema.validate(req.body);
        if (error) {
          return res.status(400).json({
            success: false,
            error: {
              message: 'Validation Error',
              details: error.details.map(d => d.message).join(', ')
            }
          });
        }
        updateData = value;
      }

      // Hook before update
      if (onBeforeUpdate) {
        updateData = await onBeforeUpdate(updateData, item, req.user, req.clinicDb);
      }

      // Update
      await item.update(updateData);

      // Hook after update
      if (onAfterUpdate) {
        await onAfterUpdate(item, req.user, req.clinicDb);
      }

      logger.info(`${modelName} updated`, {
        id: item.id,
        clinicId: req.clinicId,
        userId: req.user.id
      });

      res.json({
        success: true,
        data: item,
        message: `${displayName} updated successfully`
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /:id
   * Soft delete record (clinic-isolated)
   */
  router.delete('/:id', async (req, res, next) => {
    try {
      // Get clinic-specific model
      const Model = await getModel(req.clinicDb, modelName);

      // Check that record exists
      const item = await Model.findByPk(req.params.id, {
        where: { deletedAt: null }
      });

      if (!item) {
        return res.status(404).json({
          success: false,
          error: {
            message: `${displayName} not found`,
            details: `No ${displayName} found with this ID`
          }
        });
      }

      // Soft delete
      await item.update({ deletedAt: new Date() });

      // Hook after delete
      if (onAfterDelete) {
        await onAfterDelete(item, req.user, req.clinicDb);
      }

      logger.info(`${modelName} deleted`, {
        id: item.id,
        clinicId: req.clinicId,
        userId: req.user.id
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /search
   * Advanced search (clinic-isolated)
   */
  router.post('/search', async (req, res, next) => {
    try {
      const { search, page = 1, limit = 20, filters = {} } = req.body;

      if (!search) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Search query required',
            details: 'Provide a search parameter'
          }
        });
      }

      // Get clinic-specific model
      const Model = await getModel(req.clinicDb, modelName);

      // Build where clause
      const where = {
        deletedAt: null,
        ...filters,
        [Op.or]: searchFields.map(field => ({
          [field]: { [Op.iLike]: `%${search}%` }
        }))
      };

      // Query
      const offset = (page - 1) * limit;
      const { count, rows } = await Model.findAndCountAll({
        where,
        limit,
        offset,
        order: [['createdAt', 'DESC']],
        subQuery: false
      });

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit)
        },
        query: search
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createClinicCrudRoutes;

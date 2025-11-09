/**
 * CRUD Routes Factory - Générer des routes CRUD standardisées
 *
 * Usage:
 * const crudRoutes = require('./crudRoutes');
 * const patientRoutes = crudRoutes(Patient, {
 *   createSchema: createPatientSchema,
 *   updateSchema: updatePatientSchema,
 *   querySchema: querySchema,
 *   modelName: 'patient',
 *   searchFields: ['first_name', 'last_name', 'email', 'phone']
 * });
 * router.use('/patients', patientRoutes);
 */

const express = require('express');
const { logger } = require('../utils/logger');
const { Op } = require('sequelize');

function createCrudRoutes(Model, config = {}) {
  const router = express.Router();
  const {
    createSchema,
    updateSchema,
    querySchema,
    modelName = 'resource',
    searchFields = ['name', 'email'],
    onBeforeCreate = null,
    onBeforeUpdate = null,
    onAfterCreate = null,
    onAfterUpdate = null,
    onAfterDelete = null
  } = config;

  /**
   * GET /api/v1/:resource
   * Récupérer tous les enregistrements avec pagination
   */
  router.get('/', async (req, res, next) => {
    try {
      // Valider les paramètres
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

      // Construire la clause where
      const where = {
        company_id: req.user.companyId,
        ...filters
      };

      // Ajouter la recherche si fournie
      if (search && searchFields.length > 0) {
        where[Op.or] = searchFields.map(field => ({
          [field]: { [Op.iLike]: `%${search}%` }
        }));
      }

      // Récupérer avec pagination
      const result = await Model.findWithPagination(where, {
        page,
        limit,
        order: [['created_at', 'DESC']]
      });

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/:resource/:id
   * Récupérer un enregistrement par ID
   */
  router.get('/:id', async (req, res, next) => {
    try {
      const item = await Model.findActiveById(req.params.id, req.user.companyId);

      if (!item) {
        return res.status(404).json({
          success: false,
          error: {
            message: `${modelName} not found`,
            details: `No ${modelName} found with this ID in your company`
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
   * POST /api/v1/:resource
   * Créer un nouvel enregistrement
   */
  router.post('/', async (req, res, next) => {
    try {
      // Valider les données
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
        validatedData = await onBeforeCreate(validatedData, req.user);
      }

      // Ajouter company_id
      validatedData.company_id = req.user.companyId;

      // Créer
      const item = await Model.create(validatedData);

      // Hook after create
      if (onAfterCreate) {
        await onAfterCreate(item, req.user);
      }

      logger.info(`${modelName} created`, {
        id: item.id,
        companyId: req.user.companyId,
        userId: req.user.id,
        displayName: item.getDisplayName?.()
      });

      res.status(201).json({
        success: true,
        data: item,
        message: `${modelName} created successfully`
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PUT /api/v1/:resource/:id
   * Mettre à jour un enregistrement
   */
  router.put('/:id', async (req, res, next) => {
    try {
      // Vérifier que l'enregistrement existe
      const item = await Model.findActiveById(req.params.id, req.user.companyId);
      if (!item) {
        return res.status(404).json({
          success: false,
          error: {
            message: `${modelName} not found`,
            details: `No ${modelName} found with this ID in your company`
          }
        });
      }

      // Valider les données
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
        updateData = await onBeforeUpdate(updateData, item, req.user);
      }

      // Mettre à jour
      await item.update(updateData);

      // Hook after update
      if (onAfterUpdate) {
        await onAfterUpdate(item, req.user);
      }

      logger.info(`${modelName} updated`, {
        id: item.id,
        companyId: req.user.companyId,
        userId: req.user.id
      });

      res.json({
        success: true,
        data: item,
        message: `${modelName} updated successfully`
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/v1/:resource/:id
   * Soft delete un enregistrement
   */
  router.delete('/:id', async (req, res, next) => {
    try {
      // Vérifier que l'enregistrement existe
      const item = await Model.findActiveById(req.params.id, req.user.companyId);
      if (!item) {
        return res.status(404).json({
          success: false,
          error: {
            message: `${modelName} not found`,
            details: `No ${modelName} found with this ID in your company`
          }
        });
      }

      // Soft delete
      await item.softDelete();

      // Hook after delete
      if (onAfterDelete) {
        await onAfterDelete(item, req.user);
      }

      logger.info(`${modelName} deleted`, {
        id: item.id,
        companyId: req.user.companyId,
        userId: req.user.id
      });

      res.json({
        success: true,
        message: `${modelName} deleted successfully`
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/:resource/search
   * Recherche avancée
   */
  router.get('/search', async (req, res, next) => {
    try {
      const { search, page = 1, limit = 20 } = req.query;

      if (!search) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Search query required',
            details: 'Provide a search parameter'
          }
        });
      }

      const result = await Model.searchByCompany(
        req.user.companyId,
        search,
        searchFields,
        { page: parseInt(page), limit: parseInt(limit) }
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        query: search
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createCrudRoutes;

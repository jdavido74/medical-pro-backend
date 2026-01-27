/**
 * Treatment Consent Templates Routes
 * Manages associations between treatments (services) and consent templates
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { getModel } = require('../base/ModelFactory');
const { requirePermission } = require('../middleware/permissions');

// Validation schemas
const associateSchema = Joi.object({
  treatmentId: Joi.string().uuid().required(),
  consentTemplateId: Joi.string().uuid().required(),
  isRequired: Joi.boolean().default(true),
  sortOrder: Joi.number().integer().min(0).default(0)
});

const bulkUpdateSchema = Joi.object({
  treatmentId: Joi.string().uuid().required(),
  consentTemplateIds: Joi.array().items(Joi.string().uuid()).required(),
  isRequired: Joi.boolean().default(true)
});

const checkCoverageSchema = Joi.object({
  treatmentIds: Joi.array().items(Joi.string().uuid()).min(1).required()
});

/**
 * Transform association for API response
 */
const transformAssociation = (assoc, includeTemplate = false, includeTreatment = false) => {
  if (!assoc) return null;
  const data = assoc.toJSON ? assoc.toJSON() : assoc;

  const result = {
    id: data.id,
    treatmentId: data.treatment_id,
    consentTemplateId: data.consent_template_id,
    isRequired: data.is_required,
    sortOrder: data.sort_order,
    createdAt: data.created_at
  };

  if (includeTemplate && data.consentTemplate) {
    result.consentTemplate = {
      id: data.consentTemplate.id,
      code: data.consentTemplate.code,
      title: data.consentTemplate.title,
      consentType: data.consentTemplate.consent_type,
      version: data.consentTemplate.version
    };
  }

  if (includeTreatment && data.treatment) {
    result.treatment = {
      id: data.treatment.id,
      name: data.treatment.name,
      code: data.treatment.code
    };
  }

  return result;
};

/**
 * GET /treatment-consents
 * List all treatment-consent associations
 */
router.get('/',
  requirePermission('consents.view'),
  async (req, res) => {
    try {
      const { treatmentId, consentTemplateId } = req.query;

      const TreatmentConsentTemplate = await getModel(req.clinicDb, 'TreatmentConsentTemplate');
      const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');

      // Set up association
      if (!TreatmentConsentTemplate.associations?.consentTemplate) {
        TreatmentConsentTemplate.belongsTo(ConsentTemplate, {
          foreignKey: 'consent_template_id',
          as: 'consentTemplate'
        });
      }

      const where = {};
      if (treatmentId) where.treatment_id = treatmentId;
      if (consentTemplateId) where.consent_template_id = consentTemplateId;

      const associations = await TreatmentConsentTemplate.findAll({
        where,
        include: [{
          model: ConsentTemplate,
          as: 'consentTemplate',
          attributes: ['id', 'code', 'title', 'consent_type', 'version']
        }],
        order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
      });

      res.json({
        success: true,
        data: associations.map(a => transformAssociation(a, true))
      });
    } catch (error) {
      console.error('Error fetching treatment consent associations:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /treatment-consents/treatment/:treatmentId
 * Get consent templates for a specific treatment
 */
router.get('/treatment/:treatmentId',
  requirePermission('consents.view'),
  async (req, res) => {
    try {
      const { treatmentId } = req.params;

      const TreatmentConsentTemplate = await getModel(req.clinicDb, 'TreatmentConsentTemplate');
      const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');

      if (!TreatmentConsentTemplate.associations?.consentTemplate) {
        TreatmentConsentTemplate.belongsTo(ConsentTemplate, {
          foreignKey: 'consent_template_id',
          as: 'consentTemplate'
        });
      }

      const associations = await TreatmentConsentTemplate.findByTreatment(treatmentId, {
        include: [{
          model: ConsentTemplate,
          as: 'consentTemplate',
          attributes: ['id', 'code', 'title', 'description', 'consent_type', 'version', 'is_mandatory']
        }]
      });

      res.json({
        success: true,
        data: {
          treatmentId,
          consentTemplates: associations.map(a => ({
            ...transformAssociation(a, true),
            template: a.consentTemplate ? {
              id: a.consentTemplate.id,
              code: a.consentTemplate.code,
              title: a.consentTemplate.title,
              description: a.consentTemplate.description,
              consentType: a.consentTemplate.consent_type,
              version: a.consentTemplate.version,
              isMandatory: a.consentTemplate.is_mandatory
            } : null
          }))
        }
      });
    } catch (error) {
      console.error('Error fetching consents for treatment:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /treatment-consents
 * Create a new treatment-consent association
 */
router.post('/',
  requirePermission('consents.create'),
  async (req, res) => {
    try {
      const { error, value } = associateSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const TreatmentConsentTemplate = await getModel(req.clinicDb, 'TreatmentConsentTemplate');
      const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');

      // Verify consent template exists
      const template = await ConsentTemplate.findByPk(value.consentTemplateId);
      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Consent template not found'
        });
      }

      const { association, created } = await TreatmentConsentTemplate.associate(
        value.treatmentId,
        value.consentTemplateId,
        {
          isRequired: value.isRequired,
          sortOrder: value.sortOrder
        }
      );

      res.status(created ? 201 : 200).json({
        success: true,
        data: transformAssociation(association),
        created
      });
    } catch (error) {
      console.error('Error creating treatment consent association:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * PUT /treatment-consents/treatment/:treatmentId
 * Bulk update consent templates for a treatment
 */
router.put('/treatment/:treatmentId',
  requirePermission('consents.edit'),
  async (req, res) => {
    try {
      const { treatmentId } = req.params;
      const { consentTemplateIds, isRequired } = req.body;

      const { error, value } = bulkUpdateSchema.validate({
        treatmentId,
        consentTemplateIds: consentTemplateIds || [],
        isRequired
      });

      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const TreatmentConsentTemplate = await getModel(req.clinicDb, 'TreatmentConsentTemplate');

      const associations = await TreatmentConsentTemplate.updateTreatmentAssociations(
        treatmentId,
        value.consentTemplateIds,
        { isRequired: value.isRequired }
      );

      res.json({
        success: true,
        data: {
          treatmentId,
          associationCount: associations.length,
          associations: associations.map(a => transformAssociation(a))
        }
      });
    } catch (error) {
      console.error('Error updating treatment consent associations:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * DELETE /treatment-consents/:id
 * Remove a specific association
 */
router.delete('/:id',
  requirePermission('consents.delete'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const TreatmentConsentTemplate = await getModel(req.clinicDb, 'TreatmentConsentTemplate');

      const association = await TreatmentConsentTemplate.findByPk(id);
      if (!association) {
        return res.status(404).json({
          success: false,
          error: 'Association not found'
        });
      }

      await association.destroy();

      res.json({
        success: true,
        message: 'Association removed successfully'
      });
    } catch (error) {
      console.error('Error deleting treatment consent association:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * DELETE /treatment-consents/treatment/:treatmentId/template/:templateId
 * Remove association by treatment and template IDs
 */
router.delete('/treatment/:treatmentId/template/:templateId',
  requirePermission('consents.delete'),
  async (req, res) => {
    try {
      const { treatmentId, templateId } = req.params;

      const TreatmentConsentTemplate = await getModel(req.clinicDb, 'TreatmentConsentTemplate');

      const deleted = await TreatmentConsentTemplate.dissociate(treatmentId, templateId);

      if (deleted === 0) {
        return res.status(404).json({
          success: false,
          error: 'Association not found'
        });
      }

      res.json({
        success: true,
        message: 'Association removed successfully'
      });
    } catch (error) {
      console.error('Error deleting treatment consent association:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /treatment-consents/check-coverage
 * Check if treatments have complete consent coverage
 */
router.post('/check-coverage',
  requirePermission('consents.view'),
  async (req, res) => {
    try {
      const { error, value } = checkCoverageSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const TreatmentConsentTemplate = await getModel(req.clinicDb, 'TreatmentConsentTemplate');
      const ProductService = await getModel(req.clinicDb, 'ProductService');

      const coverage = await TreatmentConsentTemplate.checkCoverage(value.treatmentIds);

      // Get treatment names for missing ones
      const missingTreatments = [];
      if (coverage.missing.length > 0) {
        const treatments = await ProductService.findAll({
          where: { id: coverage.missing },
          attributes: ['id', 'name']
        });
        for (const id of coverage.missing) {
          const treatment = treatments.find(t => t.id === id);
          missingTreatments.push({
            id,
            name: treatment ? treatment.name : 'Unknown'
          });
        }
      }

      res.json({
        success: true,
        data: {
          complete: coverage.complete,
          coveredCount: coverage.covered.length,
          missingCount: coverage.missing.length,
          covered: coverage.covered,
          missing: missingTreatments
        }
      });
    } catch (error) {
      console.error('Error checking consent coverage:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /treatment-consents/treatments-without-consents
 * Get list of treatments that don't have any consent associations
 */
router.get('/treatments-without-consents',
  requirePermission('consents.view'),
  async (req, res) => {
    try {
      const { Op } = require('sequelize');

      const TreatmentConsentTemplate = await getModel(req.clinicDb, 'TreatmentConsentTemplate');
      const ProductService = await getModel(req.clinicDb, 'ProductService');

      // Get all treatment IDs that have consent associations
      const associations = await TreatmentConsentTemplate.findAll({
        attributes: ['treatment_id'],
        group: ['treatment_id']
      });
      const coveredTreatmentIds = associations.map(a => a.treatment_id);

      // Get all treatments (services) that are not covered
      const uncoveredTreatments = await ProductService.findAll({
        where: {
          type: 'service', // Only services/treatments
          is_active: true,
          ...(coveredTreatmentIds.length > 0 ? {
            id: { [Op.notIn]: coveredTreatmentIds }
          } : {})
        },
        attributes: ['id', 'name', 'code', 'type'],
        order: [['name', 'ASC']]
      });

      res.json({
        success: true,
        data: {
          count: uncoveredTreatments.length,
          treatments: uncoveredTreatments.map(t => ({
            id: t.id,
            name: t.name,
            code: t.code
          }))
        }
      });
    } catch (error) {
      console.error('Error fetching uncovered treatments:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * GET /treatment-consents/templates/available
 * Get available consent templates that can be associated
 */
router.get('/templates/available',
  requirePermission('consents.view'),
  async (req, res) => {
    try {
      const { treatmentId } = req.query;

      const ConsentTemplate = await getModel(req.clinicDb, 'ConsentTemplate');
      const TreatmentConsentTemplate = await getModel(req.clinicDb, 'TreatmentConsentTemplate');

      // Get active templates
      const templates = await ConsentTemplate.findActive();

      // If treatmentId is provided, mark which are already associated
      let associatedIds = [];
      if (treatmentId) {
        const associations = await TreatmentConsentTemplate.findByTreatment(treatmentId);
        associatedIds = associations.map(a => a.consent_template_id);
      }

      res.json({
        success: true,
        data: templates.map(t => ({
          id: t.id,
          code: t.code,
          title: t.title,
          description: t.description,
          consentType: t.consent_type,
          version: t.version,
          isMandatory: t.is_mandatory,
          isAssociated: associatedIds.includes(t.id)
        }))
      });
    } catch (error) {
      console.error('Error fetching available templates:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

module.exports = router;

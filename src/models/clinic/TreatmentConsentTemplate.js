/**
 * Clinic TreatmentConsentTemplate Model
 *
 * Links treatments (from catalog/products_services) to consent templates:
 * - Define which consents are required for each treatment
 * - Used for automatic consent sending when appointments are confirmed
 * - Supports partial and complete coverage detection
 *
 * This model is used ONLY with clinic-specific databases (medicalpro_clinic_*)
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes, Op } = require('sequelize');

/**
 * Create TreatmentConsentTemplate model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} TreatmentConsentTemplate model configured for the clinic database
 */
function createTreatmentConsentTemplateModel(clinicDb) {
  const TreatmentConsentTemplate = ClinicBaseModel.create(clinicDb, 'TreatmentConsentTemplate', {
    // Treatment reference (from products_services table)
    treatment_id: {
      type: DataTypes.UUID,
      allowNull: false
    },

    // Consent template reference
    consent_template_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'consent_templates',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    // Whether this consent is required for the treatment
    is_required: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },

    // Order for displaying/sending consents
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    }
  }, {
    tableName: 'treatment_consent_templates',
    updatedAt: false, // Only created_at, no updates
    indexes: [
      { fields: ['treatment_id'] },
      { fields: ['consent_template_id'] },
      { fields: ['treatment_id', 'consent_template_id'], unique: true }
    ]
  });

  // Static methods

  /**
   * Find consent templates for a treatment
   */
  TreatmentConsentTemplate.findByTreatment = async function(treatmentId, options = {}) {
    return await this.findAll({
      where: {
        treatment_id: treatmentId,
        ...options.where
      },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
      ...options
    });
  };

  /**
   * Find consent templates for multiple treatments
   */
  TreatmentConsentTemplate.findByTreatments = async function(treatmentIds, options = {}) {
    return await this.findAll({
      where: {
        treatment_id: { [Op.in]: treatmentIds },
        ...options.where
      },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
      ...options
    });
  };

  /**
   * Find treatments using a consent template
   */
  TreatmentConsentTemplate.findByConsentTemplate = async function(consentTemplateId, options = {}) {
    return await this.findAll({
      where: {
        consent_template_id: consentTemplateId,
        ...options.where
      },
      ...options
    });
  };

  /**
   * Check if all treatments have consent associations
   * @param {string[]} treatmentIds - Array of treatment IDs
   * @returns {object} { complete: boolean, covered: string[], missing: string[] }
   */
  TreatmentConsentTemplate.checkCoverage = async function(treatmentIds) {
    if (!treatmentIds || treatmentIds.length === 0) {
      return { complete: true, covered: [], missing: [], associations: [] };
    }

    const associations = await this.findAll({
      where: {
        treatment_id: { [Op.in]: treatmentIds },
        is_required: true
      }
    });

    const coveredTreatments = [...new Set(associations.map(a => a.treatment_id))];
    const missingTreatments = treatmentIds.filter(id => !coveredTreatments.includes(id));

    return {
      complete: missingTreatments.length === 0,
      covered: coveredTreatments,
      missing: missingTreatments,
      associations
    };
  };

  /**
   * Get unique consent template IDs for treatments
   */
  TreatmentConsentTemplate.getConsentTemplateIds = async function(treatmentIds) {
    if (!treatmentIds || treatmentIds.length === 0) {
      return [];
    }

    const associations = await this.findAll({
      where: {
        treatment_id: { [Op.in]: treatmentIds }
      },
      attributes: ['consent_template_id'],
      group: ['consent_template_id']
    });

    return associations.map(a => a.consent_template_id);
  };

  /**
   * Associate a consent template with a treatment
   */
  TreatmentConsentTemplate.associate = async function(treatmentId, consentTemplateId, options = {}) {
    const [association, created] = await this.findOrCreate({
      where: {
        treatment_id: treatmentId,
        consent_template_id: consentTemplateId
      },
      defaults: {
        is_required: options.isRequired !== false,
        sort_order: options.sortOrder || 0
      }
    });

    return { association, created };
  };

  /**
   * Remove association between treatment and consent template
   */
  TreatmentConsentTemplate.dissociate = async function(treatmentId, consentTemplateId) {
    return await this.destroy({
      where: {
        treatment_id: treatmentId,
        consent_template_id: consentTemplateId
      }
    });
  };

  /**
   * Bulk update associations for a treatment
   */
  TreatmentConsentTemplate.updateTreatmentAssociations = async function(treatmentId, consentTemplateIds, options = {}) {
    // Remove existing associations
    await this.destroy({
      where: { treatment_id: treatmentId }
    });

    // Create new associations
    if (consentTemplateIds && consentTemplateIds.length > 0) {
      const associations = consentTemplateIds.map((templateId, index) => ({
        treatment_id: treatmentId,
        consent_template_id: templateId,
        is_required: options.isRequired !== false,
        sort_order: index
      }));

      return await this.bulkCreate(associations);
    }

    return [];
  };

  /**
   * Count treatments without consent associations
   */
  TreatmentConsentTemplate.countTreatmentsWithoutConsents = async function(treatmentIds) {
    if (!treatmentIds || treatmentIds.length === 0) {
      return 0;
    }

    const associations = await this.findAll({
      where: {
        treatment_id: { [Op.in]: treatmentIds }
      },
      attributes: ['treatment_id'],
      group: ['treatment_id']
    });

    const coveredCount = associations.length;
    return treatmentIds.length - coveredCount;
  };

  return TreatmentConsentTemplate;
}

module.exports = createTreatmentConsentTemplateModel;

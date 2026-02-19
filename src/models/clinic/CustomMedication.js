/**
 * Clinic Custom Medication Model
 *
 * Clinic-specific custom medications that appear alongside CIMA results.
 */

const ClinicBaseModel = require('../../base/ClinicBaseModel');
const { DataTypes } = require('sequelize');

/**
 * Create CustomMedication model for a clinic database
 * @param {Sequelize} clinicDb - Clinic database connection
 * @returns {Model} CustomMedication model configured for the clinic database
 */
function createCustomMedicationModel(clinicDb) {
  const CustomMedication = ClinicBaseModel.create(clinicDb, 'CustomMedication', {
    facility_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'medical_facilities',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    name: {
      type: DataTypes.STRING(500),
      allowNull: false
    },
    active_ingredients: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    dosage: {
      type: DataTypes.STRING(200),
      allowNull: true
    },
    pharmaceutical_form: {
      type: DataTypes.STRING(200),
      allowNull: true
    },
    administration_routes: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    atc_code: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    country: {
      type: DataTypes.STRING(2),
      defaultValue: 'ES'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    tableName: 'custom_medications',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['facility_id'] },
      { fields: ['is_active'] }
    ]
  });

  /**
   * Search custom medications by name (case-insensitive)
   */
  CustomMedication.searchByName = async function(facilityId, query, limit = 20) {
    const { Op } = require('sequelize');
    return this.findAll({
      where: {
        facility_id: facilityId,
        is_active: true,
        name: { [Op.iLike]: `%${query}%` }
      },
      limit,
      order: [['name', 'ASC']]
    });
  };

  /**
   * Normalize to unified format matching CimaProvider output
   */
  CustomMedication.prototype.toNormalized = function() {
    return {
      source: 'custom',
      customMedicationId: this.id,
      nregistro: null,
      name: this.name,
      activeIngredients: this.active_ingredients || [],
      dosage: this.dosage || '',
      pharmaceuticalForm: this.pharmaceutical_form || '',
      administrationRoutes: this.administration_routes || [],
      atcCode: this.atc_code || '',
      requiresPrescription: false,
      isMarketed: true
    };
  };

  return CustomMedication;
}

module.exports = createCustomMedicationModel;

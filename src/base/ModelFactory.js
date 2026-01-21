/**
 * Model Factory for Clinic-Specific Database Connections
 *
 * Purpose: Initialize and cache model instances for each clinic database
 *
 * ARCHITECTURE:
 * - Central DB: Uses BaseModel-based models (with company_id, deleted_at)
 * - Clinic DBs: Uses ClinicBaseModel-based models (with facility_id, different schemas)
 *
 * This factory ensures we use the correct model type for each database type.
 *
 * Usage:
 * // In route handler with clinic DB:
 * const Patient = await ModelFactory.getModel(req.clinicDb, 'Patient');
 * const patients = await Patient.findAll();
 */

// Clinic-specific model factories
const createClinicPatient = require('../models/clinic/Patient');
const createClinicAppointment = require('../models/clinic/Appointment');
const createClinicHealthcareProvider = require('../models/clinic/HealthcareProvider');
const createClinicMedicalRecord = require('../models/clinic/MedicalRecord');
const createClinicPrescription = require('../models/clinic/Prescription');
const createClinicConsent = require('../models/clinic/Consent');
const createClinicConsentTemplate = require('../models/clinic/ConsentTemplate');
const createClinicConsentTemplateTranslation = require('../models/clinic/ConsentTemplateTranslation');
const createClinicConsentSigningRequest = require('../models/clinic/ConsentSigningRequest');
const createClinicPractitionerWeeklyAvailability = require('../models/clinic/PractitionerWeeklyAvailability');
const createClinicPatientCareTeam = require('../models/clinic/PatientCareTeam');

// Map of clinic model names to their factory functions
const CLINIC_MODEL_FACTORIES = {
  Patient: createClinicPatient,
  Appointment: createClinicAppointment,
  Practitioner: createClinicHealthcareProvider, // Map Practitioner → HealthcareProvider for clinics
  HealthcareProvider: createClinicHealthcareProvider,
  MedicalRecord: createClinicMedicalRecord,
  Prescription: createClinicPrescription,
  Consent: createClinicConsent,
  ConsentTemplate: createClinicConsentTemplate,
  ConsentTemplateTranslation: createClinicConsentTemplateTranslation,
  ConsentSigningRequest: createClinicConsentSigningRequest,
  PractitionerWeeklyAvailability: createClinicPractitionerWeeklyAvailability,
  PatientCareTeam: createClinicPatientCareTeam
};

// Cache for initialized models per database
// Structure: { 'clinic-db-connection': { Patient: ModelInstance, ... } }
const modelCache = new WeakMap();

/**
 * Get or initialize a model for a clinic database
 *
 * @param {Sequelize} clinicDb - Clinic database Sequelize instance
 * @param {string} modelName - Name of the model (e.g., 'Patient', 'Appointment')
 * @returns {Model} - Initialized model for the clinic database
 *
 * @throws Error if modelName is not found
 */
async function getModel(clinicDb, modelName) {
  if (!clinicDb) {
    throw new Error('clinicDb is required');
  }

  if (!CLINIC_MODEL_FACTORIES[modelName]) {
    throw new Error(
      `Model '${modelName}' not found. Available models: ${Object.keys(CLINIC_MODEL_FACTORIES).join(', ')}`
    );
  }

  // Check if we've already initialized models for this database
  if (!modelCache.has(clinicDb)) {
    modelCache.set(clinicDb, {});
  }

  const dbModels = modelCache.get(clinicDb);

  // Check if model is already initialized for this database
  if (dbModels[modelName]) {
    return dbModels[modelName];
  }

  // Get the factory function for this clinic model
  const modelFactory = CLINIC_MODEL_FACTORIES[modelName];

  // Create the model using the factory (passes clinicDb connection)
  const model = modelFactory(clinicDb);

  // Cache it
  dbModels[modelName] = model;

  // Set up associations after caching (so other models can be retrieved)
  await setupAssociations(clinicDb, modelName, model, dbModels);

  console.log(`[ModelFactory] ✅ Created clinic model '${modelName}' for database`);

  return model;
}

/**
 * Set up associations for a newly created model
 * This is called after each model is created to set up its relations
 */
async function setupAssociations(clinicDb, modelName, model, dbModels) {
  try {
    switch (modelName) {
      case 'Appointment':
        // Appointment belongs to Patient
        if (!dbModels.Patient) {
          const Patient = CLINIC_MODEL_FACTORIES.Patient(clinicDb);
          dbModels.Patient = Patient;
        }
        if (!model.associations?.patient) {
          model.belongsTo(dbModels.Patient, {
            foreignKey: 'patient_id',
            as: 'patient'
          });
        }
        break;

      case 'Patient':
        // Patient has many Appointments
        if (!dbModels.Appointment) {
          const Appointment = CLINIC_MODEL_FACTORIES.Appointment(clinicDb);
          dbModels.Appointment = Appointment;
        }
        if (!model.associations?.appointments) {
          model.hasMany(dbModels.Appointment, {
            foreignKey: 'patient_id',
            as: 'appointments'
          });
        }
        break;

      // Add more associations as needed
    }
  } catch (err) {
    console.warn(`[ModelFactory] Could not set up associations for ${modelName}:`, err.message);
  }
}

/**
 * Get all models for a clinic database
 *
 * @param {Sequelize} clinicDb - Clinic database Sequelize instance
 * @returns {Promise<Object>} - Object with all initialized models
 *
 * Usage:
 * const models = await ModelFactory.getAllModels(req.clinicDb);
 * const patients = await models.Patient.findAll();
 */
async function getAllModels(clinicDb) {
  if (!clinicDb) {
    throw new Error('clinicDb is required');
  }

  const models = {};

  for (const modelName of Object.keys(CLINIC_MODEL_FACTORIES)) {
    models[modelName] = await getModel(clinicDb, modelName);
  }

  return models;
}

/**
 * Clear cache for a specific clinic database
 * Use this after major operations or to force reinitialize
 */
function clearCache(clinicDb) {
  if (modelCache.has(clinicDb)) {
    modelCache.delete(clinicDb);
    console.log('[ModelFactory] Cache cleared for database');
  }
}

/**
 * Clear all cached models
 */
function clearAllCache() {
  // WeakMap doesn't have a clear method
  // Models will be garbage collected when database connections are closed
  console.log('[ModelFactory] All caches will be garbage collected');
}

/**
 * Get list of available model names
 */
function getAvailableModels() {
  return Object.keys(CLINIC_MODEL_FACTORIES);
}

module.exports = {
  getModel,
  getAllModels,
  clearCache,
  clearAllCache,
  getAvailableModels
};

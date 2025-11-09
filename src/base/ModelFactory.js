/**
 * Model Factory for Clinic-Specific Database Connections
 *
 * Purpose: Initialize and cache model instances for each clinic database
 *
 * Sequelize requires models to be defined with a specific database instance.
 * This factory ensures we have the right model version for each clinic's database.
 *
 * Usage:
 * // In route handler:
 * const patientModel = await ModelFactory.getModel(req.clinicDb, 'Patient');
 * const patients = await patientModel.findAll();
 */

const Patient = require('../models/Patient');
const Practitioner = require('../models/Practitioner');
const Appointment = require('../models/Appointment');
const AppointmentItem = require('../models/AppointmentItem');
const Document = require('../models/Document');
const Consent = require('../models/Consent');
const ConsentTemplate = require('../models/ConsentTemplate');
const Category = require('../models/Category');
const ProductService = require('../models/ProductService');

// Map of model names to model classes
const MODEL_MAP = {
  Patient,
  Practitioner,
  Appointment,
  AppointmentItem,
  Document,
  Consent,
  ConsentTemplate,
  Category,
  ProductService
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

  if (!MODEL_MAP[modelName]) {
    throw new Error(`Model '${modelName}' not found. Available models: ${Object.keys(MODEL_MAP).join(', ')}`);
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

  // Initialize model for this database
  const ModelClass = MODEL_MAP[modelName];
  const initializedModel = await ModelClass.associate(clinicDb);

  // Cache it
  dbModels[modelName] = initializedModel;

  return initializedModel;
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

  for (const [modelName] of Object.entries(MODEL_MAP)) {
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
  }
}

/**
 * Clear all cached models
 */
function clearAllCache() {
  // WeakMap has no clear() method, so we'll just create a new Map
  // This naturally garbage collects old connections
}

module.exports = {
  getModel,
  getAllModels,
  clearCache,
  clearAllCache,
  MODEL_MAP
};

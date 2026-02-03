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
const createClinicAppointmentAction = require('../models/clinic/AppointmentAction');
const createClinicScheduledJob = require('../models/clinic/ScheduledJob');
const createClinicTreatmentConsentTemplate = require('../models/clinic/TreatmentConsentTemplate');
const createClinicSystemCategory = require('../models/clinic/SystemCategory');

// Billing models
const createClinicDocument = require('../models/clinic/Document');
const createClinicDocumentItem = require('../models/clinic/DocumentItem');
const createClinicDocumentSequence = require('../models/clinic/DocumentSequence');

// Catalog models
const createProductService = require('../models/ProductService');
const createTag = require('../models/Tag');
const createCategory = require('../models/Category');

// Machine models
const createMachine = require('../models/Machine');

// Supplier models
const createSupplier = require('../models/Supplier');
const createProductSupplier = require('../models/ProductSupplier');

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
  PatientCareTeam: createClinicPatientCareTeam,
  // Appointment workflow models
  AppointmentAction: createClinicAppointmentAction,
  ScheduledJob: createClinicScheduledJob,
  TreatmentConsentTemplate: createClinicTreatmentConsentTemplate,
  SystemCategory: createClinicSystemCategory,
  // Billing models
  Document: createClinicDocument,
  DocumentItem: createClinicDocumentItem,
  DocumentSequence: createClinicDocumentSequence,
  // Catalog models
  ProductService: createProductService,
  Tag: createTag,
  Category: createCategory,
  // Machine models
  Machine: createMachine,
  // Supplier models
  Supplier: createSupplier,
  ProductSupplier: createProductSupplier
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
    // Model exists, but re-run associations to ensure they're set up
    // (in case related models were loaded later)
    await setupAssociations(clinicDb, modelName, dbModels[modelName], dbModels);
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

        // Appointment belongs to Machine (for treatments)
        if (!dbModels.Machine) {
          const Machine = CLINIC_MODEL_FACTORIES.Machine(clinicDb);
          dbModels.Machine = Machine;
        }
        if (!model.associations?.machine) {
          model.belongsTo(dbModels.Machine, {
            foreignKey: 'machine_id',
            as: 'machine'
          });
        }

        // Appointment belongs to HealthcareProvider (provider)
        if (!dbModels.HealthcareProvider) {
          const HealthcareProvider = CLINIC_MODEL_FACTORIES.HealthcareProvider(clinicDb);
          dbModels.HealthcareProvider = HealthcareProvider;
        }
        if (!model.associations?.provider) {
          model.belongsTo(dbModels.HealthcareProvider, {
            foreignKey: 'provider_id',
            as: 'provider'
          });
        }

        // Appointment belongs to HealthcareProvider (assistant)
        if (!model.associations?.assistant) {
          model.belongsTo(dbModels.HealthcareProvider, {
            foreignKey: 'assistant_id',
            as: 'assistant'
          });
        }

        // Appointment belongs to ProductService (service/treatment)
        if (!dbModels.ProductService) {
          const ProductService = CLINIC_MODEL_FACTORIES.ProductService(clinicDb);
          dbModels.ProductService = ProductService;
        }
        if (!model.associations?.service) {
          model.belongsTo(dbModels.ProductService, {
            foreignKey: 'service_id',
            as: 'service'
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

      case 'ProductService':
        // ProductService has many Tags (many-to-many)
        if (!dbModels.Tag) {
          const Tag = CLINIC_MODEL_FACTORIES.Tag(clinicDb);
          dbModels.Tag = Tag;
        }
        // Define junction model for product_tags
        if (!dbModels.ProductTag) {
          dbModels.ProductTag = clinicDb.define('ProductTag', {}, {
            tableName: 'product_tags',
            timestamps: false
          });
        }
        if (!model.associations?.tags) {
          model.belongsToMany(dbModels.Tag, {
            through: dbModels.ProductTag,
            foreignKey: 'product_service_id',
            otherKey: 'tag_id',
            as: 'tags'
          });
          // Set up reverse association on Tag
          if (!dbModels.Tag.associations?.products) {
            dbModels.Tag.belongsToMany(model, {
              through: dbModels.ProductTag,
              foreignKey: 'tag_id',
              otherKey: 'product_service_id',
              as: 'products'
            });
          }
        }
        // ProductService has many Categories (many-to-many)
        if (!dbModels.Category) {
          const Category = CLINIC_MODEL_FACTORIES.Category(clinicDb);
          dbModels.Category = Category;
        }
        // Define junction model for product_categories
        if (!dbModels.ProductCategory) {
          dbModels.ProductCategory = clinicDb.define('ProductCategory', {}, {
            tableName: 'product_categories',
            timestamps: false
          });
        }
        if (!model.associations?.categories) {
          model.belongsToMany(dbModels.Category, {
            through: dbModels.ProductCategory,
            foreignKey: 'product_service_id',
            otherKey: 'category_id',
            as: 'categories'
          });
          // Set up reverse association on Category
          if (!dbModels.Category.associations?.products) {
            dbModels.Category.belongsToMany(model, {
              through: dbModels.ProductCategory,
              foreignKey: 'category_id',
              otherKey: 'product_service_id',
              as: 'products'
            });
          }
        }
        // ProductService (treatments) has many Machines (many-to-many)
        if (!dbModels.Machine) {
          const Machine = CLINIC_MODEL_FACTORIES.Machine(clinicDb);
          dbModels.Machine = Machine;
        }
        // Define junction model for machine_treatments
        if (!dbModels.MachineTreatment) {
          dbModels.MachineTreatment = clinicDb.define('MachineTreatment', {}, {
            tableName: 'machine_treatments',
            timestamps: false
          });
        }
        if (!model.associations?.machines) {
          model.belongsToMany(dbModels.Machine, {
            through: dbModels.MachineTreatment,
            foreignKey: 'treatment_id',
            otherKey: 'machine_id',
            as: 'machines'
          });
          // Set up reverse association on Machine
          if (!dbModels.Machine.associations?.treatments) {
            dbModels.Machine.belongsToMany(model, {
              through: dbModels.MachineTreatment,
              foreignKey: 'machine_id',
              otherKey: 'treatment_id',
              as: 'treatments'
            });
          }
        }
        break;

      case 'Tag':
        // Tag has many ProductServices (many-to-many)
        if (!dbModels.ProductService) {
          const ProductService = CLINIC_MODEL_FACTORIES.ProductService(clinicDb);
          dbModels.ProductService = ProductService;
        }
        // Ensure junction model exists
        if (!dbModels.ProductTag) {
          dbModels.ProductTag = clinicDb.define('ProductTag', {}, {
            tableName: 'product_tags',
            timestamps: false
          });
        }
        if (!model.associations?.products) {
          model.belongsToMany(dbModels.ProductService, {
            through: dbModels.ProductTag,
            foreignKey: 'tag_id',
            otherKey: 'product_service_id',
            as: 'products'
          });
        }
        break;

      case 'Category':
        // Category has many ProductServices (many-to-many)
        if (!dbModels.ProductService) {
          const ProductService = CLINIC_MODEL_FACTORIES.ProductService(clinicDb);
          dbModels.ProductService = ProductService;
        }
        // Ensure junction model exists
        if (!dbModels.ProductCategory) {
          dbModels.ProductCategory = clinicDb.define('ProductCategory', {}, {
            tableName: 'product_categories',
            timestamps: false
          });
        }
        if (!model.associations?.products) {
          model.belongsToMany(dbModels.ProductService, {
            through: dbModels.ProductCategory,
            foreignKey: 'category_id',
            otherKey: 'product_service_id',
            as: 'products'
          });
        }
        break;

      case 'Machine':
        // Machine has many Treatments (many-to-many through machine_treatments)
        if (!dbModels.ProductService) {
          const ProductService = CLINIC_MODEL_FACTORIES.ProductService(clinicDb);
          dbModels.ProductService = ProductService;
        }
        // Define junction model for machine_treatments
        if (!dbModels.MachineTreatment) {
          dbModels.MachineTreatment = clinicDb.define('MachineTreatment', {}, {
            tableName: 'machine_treatments',
            timestamps: false
          });
        }
        if (!model.associations?.treatments) {
          model.belongsToMany(dbModels.ProductService, {
            through: dbModels.MachineTreatment,
            foreignKey: 'machine_id',
            otherKey: 'treatment_id',
            as: 'treatments'
          });
          // Set up reverse association on ProductService
          if (!dbModels.ProductService.associations?.machines) {
            dbModels.ProductService.belongsToMany(model, {
              through: dbModels.MachineTreatment,
              foreignKey: 'treatment_id',
              otherKey: 'machine_id',
              as: 'machines'
            });
          }
        }
        break;

      case 'Supplier':
        // Supplier has many ProductServices (many-to-many through product_suppliers)
        if (!dbModels.ProductService) {
          const ProductService = CLINIC_MODEL_FACTORIES.ProductService(clinicDb);
          dbModels.ProductService = ProductService;
        }
        // Ensure ProductSupplier junction model exists
        if (!dbModels.ProductSupplier) {
          const ProductSupplier = CLINIC_MODEL_FACTORIES.ProductSupplier(clinicDb);
          dbModels.ProductSupplier = ProductSupplier;
        }
        if (!model.associations?.products) {
          model.belongsToMany(dbModels.ProductService, {
            through: dbModels.ProductSupplier,
            foreignKey: 'supplier_id',
            otherKey: 'product_id',
            as: 'products'
          });
          // Set up reverse association on ProductService
          if (!dbModels.ProductService.associations?.suppliers) {
            dbModels.ProductService.belongsToMany(model, {
              through: dbModels.ProductSupplier,
              foreignKey: 'product_id',
              otherKey: 'supplier_id',
              as: 'suppliers'
            });
          }
        }
        break;

      case 'ProductSupplier':
        // ProductSupplier belongs to ProductService and Supplier
        if (!dbModels.ProductService) {
          const ProductService = CLINIC_MODEL_FACTORIES.ProductService(clinicDb);
          dbModels.ProductService = ProductService;
        }
        if (!dbModels.Supplier) {
          const Supplier = CLINIC_MODEL_FACTORIES.Supplier(clinicDb);
          dbModels.Supplier = Supplier;
        }
        if (!model.associations?.product) {
          model.belongsTo(dbModels.ProductService, {
            foreignKey: 'product_id',
            as: 'product'
          });
        }
        if (!model.associations?.supplier) {
          model.belongsTo(dbModels.Supplier, {
            foreignKey: 'supplier_id',
            as: 'supplier'
          });
        }
        break;

      case 'AppointmentAction':
        // AppointmentAction belongs to Appointment
        if (!dbModels.Appointment) {
          const Appointment = CLINIC_MODEL_FACTORIES.Appointment(clinicDb);
          dbModels.Appointment = Appointment;
        }
        if (!model.associations?.appointment) {
          model.belongsTo(dbModels.Appointment, {
            foreignKey: 'appointment_id',
            as: 'appointment'
          });
        }
        // Also set up reverse association on Appointment
        if (!dbModels.Appointment.associations?.actions) {
          dbModels.Appointment.hasMany(model, {
            foreignKey: 'appointment_id',
            as: 'actions'
          });
        }
        break;

      case 'Document':
        // Document has many DocumentItems
        if (!dbModels.DocumentItem) {
          dbModels.DocumentItem = CLINIC_MODEL_FACTORIES.DocumentItem(clinicDb);
        }
        if (!model.associations?.items) {
          model.hasMany(dbModels.DocumentItem, {
            foreignKey: 'document_id',
            as: 'items',
            onDelete: 'CASCADE'
          });
        }

        // Document belongs to Patient (optional)
        if (!dbModels.Patient) {
          dbModels.Patient = CLINIC_MODEL_FACTORIES.Patient(clinicDb);
        }
        if (!model.associations?.patient) {
          model.belongsTo(dbModels.Patient, {
            foreignKey: 'patient_id',
            as: 'patient'
          });
        }

        // Document belongs to Appointment (optional)
        if (!dbModels.Appointment) {
          dbModels.Appointment = CLINIC_MODEL_FACTORIES.Appointment(clinicDb);
        }
        if (!model.associations?.appointment) {
          model.belongsTo(dbModels.Appointment, {
            foreignKey: 'appointment_id',
            as: 'appointment'
          });
        }

        // Document belongs to HealthcareProvider (optional)
        if (!dbModels.HealthcareProvider) {
          dbModels.HealthcareProvider = CLINIC_MODEL_FACTORIES.HealthcareProvider(clinicDb);
        }
        if (!model.associations?.practitioner) {
          model.belongsTo(dbModels.HealthcareProvider, {
            foreignKey: 'practitioner_id',
            as: 'practitioner'
          });
        }

        // Self-references for conversion chain
        if (!model.associations?.convertedFrom) {
          model.belongsTo(model, {
            foreignKey: 'converted_from_id',
            as: 'convertedFrom'
          });
        }
        if (!model.associations?.convertedTo) {
          model.belongsTo(model, {
            foreignKey: 'converted_to_id',
            as: 'convertedTo'
          });
        }
        break;

      case 'DocumentItem':
        // DocumentItem belongs to Document
        if (!dbModels.Document) {
          dbModels.Document = CLINIC_MODEL_FACTORIES.Document(clinicDb);
        }
        if (!model.associations?.document) {
          model.belongsTo(dbModels.Document, {
            foreignKey: 'document_id',
            as: 'document'
          });
        }
        break;

      case 'TreatmentConsentTemplate':
        // TreatmentConsentTemplate belongs to ConsentTemplate
        if (!dbModels.ConsentTemplate) {
          const ConsentTemplate = CLINIC_MODEL_FACTORIES.ConsentTemplate(clinicDb);
          dbModels.ConsentTemplate = ConsentTemplate;
        }
        if (!model.associations?.consentTemplate) {
          model.belongsTo(dbModels.ConsentTemplate, {
            foreignKey: 'consent_template_id',
            as: 'consentTemplate'
          });
        }
        break;
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

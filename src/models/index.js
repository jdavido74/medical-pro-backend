const { sequelize } = require('../config/database');

// Import models
const Company = require('./Company');
const User = require('./User');
const Client = require('./Client');
const Invoice = require('./Invoice');
const Quote = require('./Quote');
const DocumentItem = require('./DocumentItem');
const Category = require('./Category')(sequelize);
const ProductService = require('./ProductService')(sequelize);
const ProductCategory = require('./ProductCategory')(sequelize);

// Medical models
const Patient = require('./Patient');
const Practitioner = require('./Practitioner');
const Appointment = require('./Appointment');
const AppointmentItem = require('./AppointmentItem');
const Document = require('./Document');
const Consent = require('./Consent');
const ConsentTemplate = require('./ConsentTemplate');

// Multi-clinic support
const UserClinicMembership = require('./UserClinicMembership')(sequelize);

// Définir les associations
const defineAssociations = () => {
  // ===== COMPANY ASSOCIATIONS =====
  Company.hasMany(User, {
    foreignKey: 'company_id',
    as: 'users',
    onDelete: 'CASCADE'
  });

  Company.hasMany(Client, {
    foreignKey: 'company_id',
    as: 'clients',
    onDelete: 'CASCADE'
  });

  Company.hasMany(Invoice, {
    foreignKey: 'company_id',
    as: 'invoices',
    onDelete: 'CASCADE'
  });

  Company.hasMany(Quote, {
    foreignKey: 'company_id',
    as: 'quotes',
    onDelete: 'CASCADE'
  });

  Company.hasMany(Category, {
    foreignKey: 'company_id',
    as: 'categories',
    onDelete: 'CASCADE'
  });

  Company.hasMany(ProductService, {
    foreignKey: 'company_id',
    as: 'products',
    onDelete: 'CASCADE'
  });

  // Medical associations
  Company.hasMany(Patient, {
    foreignKey: 'company_id',
    as: 'patients',
    onDelete: 'CASCADE'
  });

  Company.hasMany(Practitioner, {
    foreignKey: 'company_id',
    as: 'practitioners',
    onDelete: 'CASCADE'
  });

  Company.hasMany(Appointment, {
    foreignKey: 'company_id',
    as: 'appointments',
    onDelete: 'CASCADE'
  });

  Company.hasMany(Document, {
    foreignKey: 'company_id',
    as: 'documents',
    onDelete: 'CASCADE'
  });

  Company.hasMany(Consent, {
    foreignKey: 'company_id',
    as: 'consents',
    onDelete: 'CASCADE'
  });

  Company.hasMany(ConsentTemplate, {
    foreignKey: 'company_id',
    as: 'consent_templates',
    onDelete: 'CASCADE'
  });

  // Multi-clinic memberships
  Company.hasMany(UserClinicMembership, {
    foreignKey: 'company_id',
    as: 'memberships',
    onDelete: 'CASCADE'
  });

  UserClinicMembership.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  // User associations
  User.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  // Client associations
  Client.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  Client.hasMany(Invoice, {
    foreignKey: 'client_id',
    as: 'invoices'
  });

  Client.hasMany(Quote, {
    foreignKey: 'client_id',
    as: 'quotes'
  });

  // Invoice associations
  Invoice.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  Invoice.belongsTo(Client, {
    foreignKey: 'client_id',
    as: 'client'
  });

  Invoice.hasMany(DocumentItem, {
    foreignKey: 'document_id',
    scope: {
      document_type: 'invoice'
    },
    as: 'items'
  });

  // Quote associations
  Quote.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  Quote.belongsTo(Client, {
    foreignKey: 'client_id',
    as: 'client'
  });

  Quote.hasMany(DocumentItem, {
    foreignKey: 'document_id',
    scope: {
      document_type: 'quote'
    },
    as: 'items'
  });

  // Relation Quote -> Invoice (conversion)
  Quote.belongsTo(Invoice, {
    foreignKey: 'converted_invoice_id',
    as: 'convertedInvoice'
  });

  Invoice.hasOne(Quote, {
    foreignKey: 'converted_invoice_id',
    as: 'originalQuote'
  });

  // DocumentItem associations
  DocumentItem.belongsTo(Invoice, {
    foreignKey: 'document_id',
    constraints: false,
    scope: {
      document_type: 'invoice'
    },
    as: 'invoice'
  });

  DocumentItem.belongsTo(Quote, {
    foreignKey: 'document_id',
    constraints: false,
    scope: {
      document_type: 'quote'
    },
    as: 'quote'
  });

  DocumentItem.belongsTo(ProductService, {
    foreignKey: 'product_service_id',
    as: 'product'
  });

  // Category associations
  Category.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  Category.belongsToMany(ProductService, {
    through: ProductCategory,
    foreignKey: 'category_id',
    otherKey: 'product_service_id',
    as: 'products'
  });

  // ProductService associations
  ProductService.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  ProductService.belongsToMany(Category, {
    through: ProductCategory,
    foreignKey: 'product_service_id',
    otherKey: 'category_id',
    as: 'categories'
  });

  ProductService.hasMany(DocumentItem, {
    foreignKey: 'product_service_id',
    as: 'document_items'
  });

  // ===== MEDICAL ASSOCIATIONS =====

  // User → Practitioner (one user can be one practitioner)
  User.hasOne(Practitioner, {
    foreignKey: 'user_id',
    as: 'practitioner'
  });

  Practitioner.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
  });

  // Patient associations
  Patient.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  Patient.hasMany(Appointment, {
    foreignKey: 'patient_id',
    as: 'appointments'
  });

  Patient.hasMany(Document, {
    foreignKey: 'patient_id',
    as: 'documents'
  });

  Patient.hasMany(Consent, {
    foreignKey: 'patient_id',
    as: 'consents'
  });

  // Practitioner associations
  Practitioner.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  Practitioner.hasMany(Appointment, {
    foreignKey: 'practitioner_id',
    as: 'appointments'
  });

  // Appointment associations
  Appointment.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  Appointment.belongsTo(Patient, {
    foreignKey: 'patient_id',
    as: 'patient'
  });

  Appointment.belongsTo(Practitioner, {
    foreignKey: 'practitioner_id',
    as: 'practitioner'
  });

  Appointment.hasMany(AppointmentItem, {
    foreignKey: 'appointment_id',
    as: 'items'
  });

  Appointment.belongsTo(Document, {
    foreignKey: 'quote_id',
    as: 'quote'
  });

  // AppointmentItem associations
  AppointmentItem.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  AppointmentItem.belongsTo(Appointment, {
    foreignKey: 'appointment_id',
    as: 'appointment'
  });

  AppointmentItem.belongsTo(ProductService, {
    foreignKey: 'product_service_id',
    as: 'product'
  });

  // Document (Quote + Invoice) associations
  Document.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  Document.belongsTo(Patient, {
    foreignKey: 'patient_id',
    as: 'patient'
  });

  Document.belongsTo(Appointment, {
    foreignKey: 'appointment_id',
    as: 'appointment'
  });

  Document.belongsTo(Practitioner, {
    foreignKey: 'practitioner_id',
    as: 'practitioner'
  });

  // Consent associations
  Consent.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  Consent.belongsTo(Patient, {
    foreignKey: 'patient_id',
    as: 'patient'
  });

  Consent.belongsTo(Appointment, {
    foreignKey: 'appointment_id',
    as: 'appointment'
  });

  Consent.belongsTo(ProductService, {
    foreignKey: 'product_service_id',
    as: 'product'
  });

  Consent.belongsTo(ConsentTemplate, {
    foreignKey: 'consent_template_id',
    as: 'template'
  });

  Consent.belongsTo(Document, {
    foreignKey: 'related_document_id',
    as: 'related_document'
  });

  // ConsentTemplate associations
  ConsentTemplate.belongsTo(Company, {
    foreignKey: 'company_id',
    as: 'company'
  });

  ConsentTemplate.hasMany(Consent, {
    foreignKey: 'consent_template_id',
    as: 'consents'
  });
};

// Initialiser les associations
defineAssociations();

module.exports = {
  sequelize,
  Company,
  User,
  Client,
  Invoice,
  Quote,
  DocumentItem,
  Category,
  ProductService,
  ProductCategory,
  // Medical models
  Patient,
  Practitioner,
  Appointment,
  AppointmentItem,
  Document,
  Consent,
  ConsentTemplate,
  // Multi-clinic support
  UserClinicMembership,
  defineAssociations
};
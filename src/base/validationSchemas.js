/**
 * Validation Schemas Factory
 * Fournit des schémas Joi réutilisables et combinables
 *
 * Usage:
 * const schemas = require('./validationSchemas');
 * const patientCreateSchema = Joi.object({
 *   ...schemas.contact(),
 *   ...schemas.medicalFields(),
 *   first_name: schemas.firstName.required(),
 *   last_name: schemas.lastName.required()
 * });
 */

const Joi = require('joi');

module.exports = {
  // === Champs communs ===

  /**
   * Prénom
   */
  firstName: Joi.string().min(2).max(100).trim(),

  /**
   * Nom
   */
  lastName: Joi.string().min(2).max(100).trim(),

  /**
   * Email
   */
  email: Joi.string().email().lowercase().trim(),

  /**
   * Téléphone
   */
  phone: Joi.string()
    .pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/)
    .messages({
      'string.pattern.base': 'Phone must be a valid phone number'
    }),

  /**
   * Adresse
   */
  address: Joi.object({
    street: Joi.string().max(255).optional(),
    city: Joi.string().max(100).optional(),
    postalCode: Joi.string().max(20).optional(),
    country: Joi.string().max(100).optional(),
    state: Joi.string().max(100).optional(),
    complement: Joi.string().max(255).optional()
  }).optional(),

  /**
   * Notes
   */
  notes: Joi.string().max(1000).optional(),

  /**
   * Statut actif/inactif
   */
  isActive: Joi.boolean().optional(),

  // === Champs médicaux ===

  /**
   * Date de naissance
   */
  dateOfBirth: Joi.date().iso().max('now').messages({
    'date.max': 'Date of birth cannot be in the future'
  }),

  /**
   * Sexe
   */
  gender: Joi.string().valid('M', 'F', 'O', 'N/A').optional(),

  /**
   * Numéro de sécurité sociale (chiffré)
   */
  socialSecurityNumber: Joi.string()
    .pattern(/^\d{15}$/)
    .optional()
    .messages({
      'string.pattern.base': 'SSN must be 15 digits'
    }),

  /**
   * Numéro de patient
   */
  patientNumber: Joi.string().max(50).optional(),

  /**
   * Raison (consultation, appointment)
   */
  reason: Joi.string().max(500).optional(),

  /**
   * Description (pour records, notes)
   */
  description: Joi.string().max(2000).optional(),

  /**
   * Statut de rendez-vous
   */
  appointmentStatus: Joi.string()
    .valid('scheduled', 'confirmed', 'cancelled', 'completed', 'no-show')
    .optional(),

  /**
   * Type de record médical
   */
  medicalRecordType: Joi.string()
    .valid('consultation', 'examination', 'lab_result', 'prescription', 'imaging', 'note')
    .optional(),

  // === Champs de pagination et recherche ===

  /**
   * Paramètres de pagination
   */
  pagination: () => ({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  }),

  /**
   * Recherche
   */
  search: () => ({
    search: Joi.string().max(255).optional()
  }),

  /**
   * Paramètres de requête standards (pagination + search)
   */
  queryParams: () => ({
    ...module.exports.pagination(),
    ...module.exports.search()
  }),

  // === Objets composés ===

  /**
   * Contact (email + phone)
   */
  contact: () => ({
    email: module.exports.email.optional(),
    phone: module.exports.phone.optional()
  }),

  /**
   * Adresse complète
   */
  addressFull: () => ({
    address: module.exports.address.required()
  }),

  /**
   * Informations de base (firstName + lastName)
   */
  basicInfo: () => ({
    first_name: module.exports.firstName.required(),
    last_name: module.exports.lastName.required()
  }),

  /**
   * Informations sensibles d'une personne
   */
  personalInfo: () => ({
    ...module.exports.basicInfo(),
    ...module.exports.contact(),
    date_of_birth: module.exports.dateOfBirth.optional(),
    gender: module.exports.gender
  }),

  // === Schémas préconstruits ===

  /**
   * Schéma pour créer un patient
   */
  createPatientSchema: Joi.object({
    first_name: module.exports.firstName.required(),
    last_name: module.exports.lastName.required(),
    email: module.exports.email.optional(),
    phone: module.exports.phone.optional(),
    date_of_birth: module.exports.dateOfBirth.optional(),
    gender: module.exports.gender,
    social_security_number: module.exports.socialSecurityNumber,
    patient_number: module.exports.patientNumber,
    address: module.exports.address,
    medical_history: Joi.object().optional(),
    emergency_contact: Joi.object({
      name: Joi.string().required(),
      phone: module.exports.phone.required(),
      relationship: Joi.string().optional()
    }).optional(),
    insurance_info: Joi.object({
      company: Joi.string().optional(),
      policy_number: Joi.string().optional(),
      coverage_type: Joi.string().optional()
    }).optional(),
    is_incomplete: Joi.boolean().optional(),
    notes: module.exports.notes
  }),

  /**
   * Schéma pour mettre à jour un patient
   */
  updatePatientSchema: Joi.object({
    first_name: module.exports.firstName.optional(),
    last_name: module.exports.lastName.optional(),
    email: module.exports.email.optional(),
    phone: module.exports.phone.optional(),
    date_of_birth: module.exports.dateOfBirth.optional(),
    gender: module.exports.gender,
    social_security_number: module.exports.socialSecurityNumber,
    patient_number: module.exports.patientNumber,
    address: module.exports.address,
    medical_history: Joi.object().optional(),
    emergency_contact: Joi.object({
      name: Joi.string().optional(),
      phone: module.exports.phone.optional(),
      relationship: Joi.string().optional()
    }).optional(),
    insurance_info: Joi.object({
      company: Joi.string().optional(),
      policy_number: Joi.string().optional(),
      coverage_type: Joi.string().optional()
    }).optional(),
    is_incomplete: Joi.boolean().optional(),
    notes: module.exports.notes
  }).min(1),

  /**
   * Schéma pour créer un praticien
   */
  createPractitionerSchema: Joi.object({
    first_name: module.exports.firstName.required(),
    last_name: module.exports.lastName.required(),
    license_number: Joi.string().required(),
    speciality: Joi.array().items(Joi.string()).optional(),
    email: module.exports.email.optional(),
    phone: module.exports.phone.optional(),
    bio: Joi.string().max(500).optional(),
    photo_url: Joi.string().uri().optional(),
    working_hours: Joi.object().optional(),
    is_active: module.exports.isActive
  }),

  /**
   * Schéma pour créer un rendez-vous
   */
  createAppointmentSchema: Joi.object({
    patient_id: Joi.string().uuid().required(),
    practitioner_id: Joi.string().uuid().required(),
    start_time: Joi.date().iso().required().messages({
      'date.base': 'Start time must be a valid ISO date'
    }),
    end_time: Joi.date().iso().required().messages({
      'date.base': 'End time must be a valid ISO date'
    }),
    reason: module.exports.reason.optional(),
    notes: Joi.object().optional(),
    status: module.exports.appointmentStatus.default('scheduled')
  }).custom((value, helpers) => {
    if (new Date(value.start_time) >= new Date(value.end_time)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'appointment time validation').messages({
    'any.invalid': 'End time must be after start time'
  }),

  /**
   * Schéma pour créer un record médical
   */
  createMedicalRecordSchema: Joi.object({
    patient_id: Joi.string().uuid().required(),
    appointment_id: Joi.string().uuid().optional(),
    record_type: module.exports.medicalRecordType.required(),
    title: Joi.string().required(),
    description: module.exports.description.optional(),
    findings: Joi.object().optional(),
    treatment: Joi.object().optional(),
    is_sensitive: Joi.boolean().optional(),
    notes: module.exports.notes
  }),

  /**
   * Schéma pour créer un consentement
   */
  createConsentSchema: Joi.object({
    patient_id: Joi.string().uuid().required(),
    consent_template_id: Joi.string().uuid().optional(),
    consent_type: Joi.string()
      .valid('gdpr', 'medical_treatment', 'data_sharing', 'research', 'photo')
      .required(),
    status: Joi.string().valid('pending', 'accepted', 'rejected').default('pending'),
    accepted_at: Joi.date().iso().optional(),
    expires_at: Joi.date().iso().optional()
  })
};

/**
 * Validation Schemas Factory
 * Fournit des schémas Joi réutilisables et combinables
 */

const Joi = require('joi');

// First, define all atomic schemas
const atomicSchemas = {
  firstName: Joi.string().min(2).max(100).trim(),
  lastName: Joi.string().min(2).max(100).trim(),
  email: Joi.string().email().lowercase().trim(),
  phone: Joi.string()
    .pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/)
    .messages({
      'string.pattern.base': 'Phone must be a valid phone number'
    }),
  address: Joi.object({
    street: Joi.string().max(255).optional(),
    city: Joi.string().max(100).optional(),
    postalCode: Joi.string().max(20).optional(),
    country: Joi.string().max(100).optional(),
    state: Joi.string().max(100).optional(),
    complement: Joi.string().max(255).optional()
  }).optional(),
  notes: Joi.string().max(1000).optional(),
  isActive: Joi.boolean().optional(),
  dateOfBirth: Joi.date().iso().max('now').messages({
    'date.max': 'Date of birth cannot be in the future'
  }),
  gender: Joi.string().valid('M', 'F', 'O', 'N/A').optional(),
  socialSecurityNumber: Joi.string()
    .pattern(/^\d{15}$/)
    .optional()
    .messages({
      'string.pattern.base': 'SSN must be 15 digits'
    }),
  patientNumber: Joi.string().max(50).optional(),
  reason: Joi.string().max(500).optional(),
  description: Joi.string().max(2000).optional(),
  appointmentStatus: Joi.string()
    .valid('scheduled', 'confirmed', 'cancelled', 'completed', 'no-show')
    .optional(),
  medicalRecordType: Joi.string()
    .valid('consultation', 'examination', 'lab_result', 'prescription', 'imaging', 'note')
    .optional(),
};

// Export the atomic schemas first
module.exports = atomicSchemas;

// Now add composite schemas as functions
module.exports.pagination = () => ({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

module.exports.search = () => ({
  search: Joi.string().max(255).optional()
});

module.exports.queryParams = () => ({
  ...module.exports.pagination(),
  ...module.exports.search()
});

module.exports.contact = () => ({
  email: atomicSchemas.email.optional(),
  phone: atomicSchemas.phone.optional()
});

module.exports.basicInfo = () => ({
  first_name: atomicSchemas.firstName.required(),
  last_name: atomicSchemas.lastName.required()
});

// Lazy-loaded composite schemas
module.exports.createPatientSchema = Joi.object({
  first_name: atomicSchemas.firstName.required(),
  last_name: atomicSchemas.lastName.required(),
  email: atomicSchemas.email.optional(),
  phone: atomicSchemas.phone.optional(),
  date_of_birth: atomicSchemas.dateOfBirth.optional(),
  gender: atomicSchemas.gender,
  social_security_number: atomicSchemas.socialSecurityNumber,
  patient_number: atomicSchemas.patientNumber,
  address: atomicSchemas.address,
  medical_history: Joi.object().optional(),
  emergency_contact: Joi.object({
    name: Joi.string().required(),
    phone: atomicSchemas.phone.required(),
    relationship: Joi.string().optional()
  }).optional(),
  insurance_info: Joi.object({
    company: Joi.string().optional(),
    policy_number: Joi.string().optional(),
    coverage_type: Joi.string().optional()
  }).optional(),
  is_incomplete: Joi.boolean().optional(),
  notes: atomicSchemas.notes
});

module.exports.updatePatientSchema = Joi.object({
  first_name: atomicSchemas.firstName.optional(),
  last_name: atomicSchemas.lastName.optional(),
  email: atomicSchemas.email.optional(),
  phone: atomicSchemas.phone.optional(),
  date_of_birth: atomicSchemas.dateOfBirth.optional(),
  gender: atomicSchemas.gender,
  social_security_number: atomicSchemas.socialSecurityNumber,
  patient_number: atomicSchemas.patientNumber,
  address: atomicSchemas.address,
  medical_history: Joi.object().optional(),
  emergency_contact: Joi.object({
    name: Joi.string().optional(),
    phone: atomicSchemas.phone.optional(),
    relationship: Joi.string().optional()
  }).optional(),
  insurance_info: Joi.object({
    company: Joi.string().optional(),
    policy_number: Joi.string().optional(),
    coverage_type: Joi.string().optional()
  }).optional(),
  is_incomplete: Joi.boolean().optional(),
  notes: atomicSchemas.notes
}).min(1);

module.exports.createAppointmentSchema = Joi.object({
  patient_id: Joi.string().uuid().required(),
  practitioner_id: Joi.string().uuid().required(),
  start_time: Joi.date().iso().required().messages({
    'date.base': 'Start time must be a valid ISO date'
  }),
  end_time: Joi.date().iso().required().messages({
    'date.base': 'End time must be a valid ISO date'
  }),
  reason: atomicSchemas.reason.optional(),
  notes: Joi.object().optional(),
  status: atomicSchemas.appointmentStatus.default('scheduled')
}).custom((value, helpers) => {
  if (new Date(value.start_time) >= new Date(value.end_time)) {
    return helpers.error('any.invalid');
  }
  return value;
}, 'appointment time validation').messages({
  'any.invalid': 'End time must be after start time'
});

module.exports.createMedicalRecordSchema = Joi.object({
  patient_id: Joi.string().uuid().required(),
  appointment_id: Joi.string().uuid().optional(),
  record_type: atomicSchemas.medicalRecordType.required(),
  title: Joi.string().required(),
  description: atomicSchemas.description.optional(),
  findings: Joi.object().optional(),
  treatment: Joi.object().optional(),
  is_sensitive: Joi.boolean().optional(),
  notes: atomicSchemas.notes
});

module.exports.createConsentSchema = Joi.object({
  patient_id: Joi.string().uuid().required(),
  consent_template_id: Joi.string().uuid().optional(),
  consent_type: Joi.string()
    .valid('gdpr', 'medical_treatment', 'data_sharing', 'research', 'photo')
    .required(),
  status: Joi.string().valid('pending', 'accepted', 'rejected').default('pending'),
  accepted_at: Joi.date().iso().optional(),
  expires_at: Joi.date().iso().optional()
});

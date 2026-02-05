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
    .max(50)
    .optional()
    .messages({
      'string.max': 'Social security number must not exceed 50 characters'
    }),
  idNumber: Joi.string().max(50).optional(),  // DNI, NIE, Passport, etc.
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
  facility_id: Joi.string().uuid().optional(),

  // ============================================
  // REQUIRED FIELDS (4 uniquement)
  // ============================================
  first_name: atomicSchemas.firstName.required().messages({
    'any.required': 'Le nom est obligatoire / El nombre es obligatorio',
    'string.empty': 'Le nom ne peut pas être vide / El nombre no puede estar vacío',
    'string.min': 'Le nom doit contenir au moins 2 caractères / El nombre debe tener al menos 2 caracteres'
  }),
  last_name: atomicSchemas.lastName.required().messages({
    'any.required': 'Le prénom est obligatoire / Los apellidos son obligatorios',
    'string.empty': 'Le prénom ne peut pas être vide / Los apellidos no pueden estar vacíos',
    'string.min': 'Le prénom doit contenir au moins 2 caractères / Los apellidos deben tener al menos 2 caracteres'
  }),
  email: atomicSchemas.email.required().messages({
    'any.required': 'L\'email est obligatoire / El email es obligatorio',
    'string.empty': 'L\'email ne peut pas être vide / El email no puede estar vacío',
    'string.email': 'Format d\'email invalide / Formato de email inválido'
  }),
  phone: atomicSchemas.phone.required().messages({
    'any.required': 'Le téléphone est obligatoire / El teléfono es obligatorio',
    'string.empty': 'Le téléphone ne peut pas être vide / El teléfono no puede estar vacío',
    'string.pattern.base': 'Le téléphone doit contenir l\'indicatif pays (ex: +34612345678) / El teléfono debe incluir código de país (ej: +34612345678)'
  }),

  // ============================================
  // OPTIONAL FIELDS (tout le reste)
  // ============================================

  // Identity
  birth_date: Joi.date().iso().max('now').allow(null, '').optional().messages({
    'date.base': 'Date de naissance invalide / Fecha de nacimiento inválida',
    'date.max': 'La date de naissance ne peut pas être future / La fecha de nacimiento no puede ser futura'
  }),
  date_of_birth: Joi.date().iso().max('now').allow(null, '').optional(), // Backward compatibility
  gender: atomicSchemas.gender,
  nationality: Joi.string().max(100).allow('').optional(),

  // ID Documents
  id_number: atomicSchemas.idNumber,
  social_security_number: atomicSchemas.socialSecurityNumber,
  patient_number: atomicSchemas.patientNumber,

  // Contact
  mobile: Joi.string().allow('').optional(),

  // Address
  address_line1: Joi.string().allow('').optional(),
  address_line2: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  postal_code: Joi.string().allow('').optional(),
  country: Joi.string().length(2).allow('').optional(),
  address: atomicSchemas.address,

  // Medical
  blood_type: Joi.string().allow('').optional(),
  allergies: Joi.string().allow('').optional(),
  chronic_conditions: Joi.string().allow('').optional(),
  current_medications: Joi.string().allow('').optional(),
  medical_history: Joi.object().allow(null).optional(),

  // Emergency Contact
  emergency_contact: Joi.object({
    name: Joi.string().allow(null, '').optional(),
    phone: Joi.string().allow(null, '').optional(),
    relationship: Joi.string().allow(null, '').optional()
  }).allow(null).optional(),
  emergency_contact_name: Joi.string().allow(null, '').optional(),
  emergency_contact_phone: Joi.string().allow(null, '').optional(),
  emergency_contact_relationship: Joi.string().allow(null, '').optional(),

  // Insurance
  insurance_info: Joi.object({
    company: Joi.string().allow(null, '').optional(),
    policy_number: Joi.string().allow(null, '').optional(),
    coverage_type: Joi.string().allow(null, '').optional()
  }).allow(null).optional(),
  insurance_provider: Joi.string().allow('').optional(),
  insurance_number: Joi.string().allow('').optional(),
  coverage_type: Joi.string().allow('').optional(),

  // Metadata
  is_incomplete: Joi.boolean().optional(),
  is_active: Joi.boolean().optional(),
  notes: atomicSchemas.notes
});

module.exports.updatePatientSchema = Joi.object({
  // ============================================
  // CORE FIELDS (aligned with createPatientSchema)
  // ============================================

  // Identity
  first_name: atomicSchemas.firstName.optional(),
  last_name: atomicSchemas.lastName.optional(),
  birth_date: Joi.date().iso().max('now').allow(null, '').optional(),
  date_of_birth: Joi.date().iso().max('now').allow(null, '').optional(), // Backward compatibility
  gender: atomicSchemas.gender,
  nationality: Joi.string().max(100).allow('').optional(),

  // ID Documents
  id_number: atomicSchemas.idNumber,
  social_security_number: atomicSchemas.socialSecurityNumber,
  patient_number: atomicSchemas.patientNumber,

  // Contact
  email: atomicSchemas.email.optional(),
  phone: atomicSchemas.phone.optional(),
  mobile: Joi.string().allow('').optional(),

  // Address
  address_line1: Joi.string().allow('').optional(),
  address_line2: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  postal_code: Joi.string().allow('').optional(),
  country: Joi.string().length(2).allow('').optional(),
  address: atomicSchemas.address,

  // Medical
  blood_type: Joi.string().allow('').optional(),
  allergies: Joi.string().allow('').optional(),
  chronic_conditions: Joi.string().allow('').optional(),
  current_medications: Joi.string().allow('').optional(),
  medical_history: Joi.object().allow(null).optional(),

  // Emergency Contact
  emergency_contact: Joi.object({
    name: Joi.string().allow(null, '').optional(),
    phone: Joi.string().allow(null, '').optional(),
    relationship: Joi.string().allow(null, '').optional()
  }).allow(null).optional(),
  emergency_contact_name: Joi.string().allow(null, '').optional(),
  emergency_contact_phone: Joi.string().allow(null, '').optional(),
  emergency_contact_relationship: Joi.string().allow(null, '').optional(),

  // Insurance
  insurance_info: Joi.object({
    company: Joi.string().allow(null, '').optional(),
    policy_number: Joi.string().allow(null, '').optional(),
    coverage_type: Joi.string().allow(null, '').optional()
  }).allow(null).optional(),
  insurance_provider: Joi.string().allow('').optional(),
  insurance_number: Joi.string().allow('').optional(),
  coverage_type: Joi.string().allow('').optional(),

  // Metadata
  is_incomplete: Joi.boolean().optional(),
  is_active: Joi.boolean().optional(),
  notes: atomicSchemas.notes
}).min(1);

module.exports.createAppointmentSchema = Joi.object({
  // IDs
  facility_id: Joi.string().uuid().optional(), // Will use default if not provided
  patient_id: Joi.string().uuid().required(),
  provider_id: Joi.string().uuid().required(), // IMPORTANT: provider_id NOT practitioner_id!

  // Date and time (SEPARATE fields, not ISO timestamp!)
  appointment_date: Joi.date().iso().required().messages({
    'date.base': 'Appointment date must be a valid date'
  }),
  start_time: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required().messages({
    'string.pattern.base': 'Start time must be in HH:MM or HH:MM:SS format'
  }),
  end_time: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required().messages({
    'string.pattern.base': 'End time must be in HH:MM or HH:MM:SS format'
  }),

  // Duration
  duration_minutes: Joi.number().integer().min(1).max(480).optional(),

  // Type (REQUIRED in database)
  // Types aligned with frontend: consultation, followup, emergency, specialist, checkup, vaccination, surgery, procedure, teleconsultation
  type: Joi.string()
    .valid('consultation', 'followup', 'emergency', 'checkup', 'procedure', 'teleconsultation', 'specialist', 'vaccination', 'surgery')
    .required(),

  // Details (all optional - empty strings allowed)
  title: Joi.string().max(255).allow('', null).optional(),
  reason: Joi.string().max(1000).allow('', null).optional(),
  description: Joi.string().max(2000).allow('', null).optional(),
  notes: Joi.string().max(5000).allow('', null).optional(),

  // Priority
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal'),

  // Location
  location: Joi.string().max(255).allow('', null).optional(),

  // Status
  status: atomicSchemas.appointmentStatus.default('scheduled'),

  // Reminders configuration
  reminders: Joi.object({
    patient: Joi.object({
      enabled: Joi.boolean().default(true),
      beforeMinutes: Joi.number().integer().min(0).max(10080).default(1440) // max 1 week
    }).optional(),
    practitioner: Joi.object({
      enabled: Joi.boolean().default(true),
      beforeMinutes: Joi.number().integer().min(0).max(10080).default(30)
    }).optional()
  }).optional(),

  // Additional optional fields
  is_teleconsultation: Joi.boolean().optional(),
  meeting_link: Joi.string().uri().max(255).optional(),
  consultation_fee: Joi.number().precision(2).min(0).optional(),
  insurance_covered: Joi.boolean().optional()
}).custom((value, helpers) => {
  // Validate that end_time is after start_time
  const start = value.start_time.length === 5 ? `${value.start_time}:00` : value.start_time;
  const end = value.end_time.length === 5 ? `${value.end_time}:00` : value.end_time;

  if (end <= start) {
    return helpers.error('any.invalid');
  }
  return value;
}, 'appointment time validation').messages({
  'any.invalid': 'End time must be after start time'
});

// Medical Record Schemas - Comprehensive for clinic medical records
module.exports.createMedicalRecordSchema = Joi.object({
  // Required relationships
  facility_id: Joi.string().uuid().optional(), // Auto-filled if not provided
  patient_id: Joi.string().uuid().required().messages({
    'any.required': 'L\'identifiant du patient est obligatoire'
  }),
  provider_id: Joi.string().uuid().optional(),

  // Date de consultation (éditable, par défaut = date de création)
  record_date: Joi.date().iso().allow(null).optional(),

  // Assistant optionnel (infirmière, aide-soignant, etc.)
  assistant_provider_id: Joi.string().uuid().allow(null).optional(),

  // Record type
  record_type: Joi.string()
    .valid('consultation', 'examination', 'treatment', 'follow_up', 'emergency', 'prescription', 'lab_result', 'imaging', 'note')
    .default('consultation'),

  // Basic consultation info (all fields optional and can be empty)
  chief_complaint: Joi.string().max(2000).allow('', null).optional(),
  symptoms: Joi.array().items(Joi.string().allow('', null)).optional(),
  duration: Joi.string().max(100).allow('', null).optional(),

  // Vital signs
  vital_signs: Joi.object({
    weight: Joi.number().min(0).max(500).optional(),
    height: Joi.number().min(0).max(300).optional(),
    bmi: Joi.number().min(0).max(100).optional(),
    blood_pressure: Joi.object({
      systolic: Joi.number().min(0).max(300).optional(),
      diastolic: Joi.number().min(0).max(200).optional()
    }).optional(),
    heart_rate: Joi.number().min(0).max(300).optional(),
    temperature: Joi.number().min(30).max(45).optional(),
    respiratory_rate: Joi.number().min(0).max(100).optional(),
    oxygen_saturation: Joi.number().min(0).max(100).optional()
  }).optional(),

  // Medical history (antecedents)
  antecedents: Joi.object().optional(),

  // Allergies (allergen required if adding an allergy, other fields optional)
  allergies: Joi.array().items(Joi.object({
    allergen: Joi.string().required(),
    type: Joi.string().allow('', null).optional(),
    severity: Joi.string().valid('low', 'moderate', 'severe', 'grave').allow('', null).optional(),
    reaction: Joi.string().allow('', null).optional(),
    date_discovered: Joi.date().iso().allow(null).optional()
  })).optional(),

  // Diagnosis (all fields optional and can be empty)
  diagnosis: Joi.object({
    primary: Joi.string().allow('', null).optional(),
    secondary: Joi.array().items(Joi.string().allow('', null)).optional(),
    icd10: Joi.array().items(Joi.string().allow('', null)).optional()
  }).optional(),

  // Chronic conditions (condition required if adding one, other fields optional)
  chronic_conditions: Joi.array().items(Joi.object({
    condition: Joi.string().required(),
    diagnosis_date: Joi.date().iso().allow(null).optional(),
    practitioner: Joi.string().allow('', null).optional(),
    status: Joi.string().valid('active', 'resolved', 'managed').allow('', null).optional(),
    notes: Joi.string().allow('', null).optional()
  })).optional(),

  // Physical examination
  physical_exam: Joi.object().optional(),

  // Treatments/Medications (medication required if adding a treatment, other fields optional)
  treatments: Joi.array().items(Joi.object({
    medication: Joi.string().required(),
    dosage: Joi.string().allow('', null).optional(),
    frequency: Joi.string().allow('', null).optional(),
    route: Joi.string().allow('', null).optional(),
    start_date: Joi.date().iso().allow(null).optional(),
    end_date: Joi.date().iso().allow(null).optional(),
    status: Joi.string().valid('active', 'completed', 'stopped', 'paused').allow('', null).optional(),
    prescribed_by: Joi.string().allow('', null).optional(),
    notes: Joi.string().allow('', null).optional(),
    catalog_item_id: Joi.string().allow('', null).optional(),
    catalog_item_type: Joi.string().allow('', null).optional()
  })).optional(),

  // Treatment plan (all fields optional and can be empty)
  treatment_plan: Joi.object({
    recommendations: Joi.array().items(Joi.string().allow('', null)).optional(),
    follow_up: Joi.date().iso().allow(null).optional(),
    tests: Joi.array().items(Joi.string().allow('', null)).optional()
  }).optional(),

  // Current medications (medication required if adding one, other fields optional)
  current_medications: Joi.array().items(Joi.object({
    medication: Joi.string().required(),
    dosage: Joi.string().allow('', null).optional(),
    frequency: Joi.string().allow('', null).optional(),
    start_date: Joi.date().iso().allow(null).optional(),
    prescribed_by: Joi.string().allow('', null).optional(),
    notes: Joi.string().allow('', null).optional()
  })).optional(),

  // Blood type
  blood_type: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').allow('', null).optional(),

  // Notes
  notes: Joi.string().max(5000).allow('', null).optional(),
  private_notes: Joi.string().max(5000).allow('', null).optional()
});

module.exports.updateMedicalRecordSchema = Joi.object({
  // Can update most fields except patient_id

  // Date de consultation (éditable)
  record_date: Joi.date().iso().allow(null).optional(),

  // Assistant optionnel (infirmière, aide-soignant, etc.)
  assistant_provider_id: Joi.string().uuid().allow(null, '').optional(),

  record_type: Joi.string()
    .valid('consultation', 'examination', 'treatment', 'follow_up', 'emergency', 'prescription', 'lab_result', 'imaging', 'note')
    .optional(),
  chief_complaint: Joi.string().max(2000).allow('', null).optional(),
  symptoms: Joi.array().items(Joi.string()).optional(),
  duration: Joi.string().max(100).allow('', null).optional(),
  vital_signs: Joi.object().optional(),
  antecedents: Joi.object().optional(),
  allergies: Joi.array().optional(),
  diagnosis: Joi.object().optional(),
  chronic_conditions: Joi.array().optional(),
  physical_exam: Joi.object().optional(),
  treatments: Joi.array().optional(),
  treatment_plan: Joi.object().optional(),
  current_medications: Joi.array().optional(),
  blood_type: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').allow('', null).optional(),
  notes: Joi.string().max(5000).allow('', null).optional(),
  private_notes: Joi.string().max(5000).allow('', null).optional(),
  provider_id: Joi.string().uuid().optional()
}).min(1);

module.exports.createConsentSchema = Joi.object({
  // Relations
  patient_id: Joi.string().uuid().required(),
  appointment_id: Joi.string().uuid().optional(),
  consent_template_id: Joi.string().uuid().optional(),
  product_service_id: Joi.string().uuid().optional(),

  // Type
  consent_type: Joi.string()
    .valid('gdpr', 'medical_treatment', 'data_sharing', 'research', 'photo', 'data_processing', 'communication', 'medical_specific')
    .required(),

  // Content
  title: Joi.string().max(255).required(),
  description: Joi.string().max(5000).optional(),
  terms: Joi.string().max(10000).optional(),
  purpose: Joi.string().max(1000).optional(),

  // Status
  status: Joi.string().valid('pending', 'accepted', 'rejected', 'granted', 'revoked').default('pending'),

  // Configuration
  is_required: Joi.boolean().default(false),
  signature_method: Joi.string().valid('digital', 'checkbox', 'pin', 'verbal', 'written').default('digital'),

  // Expiration
  expires_at: Joi.date().iso().optional(),

  // Witness (for verbal consents)
  witness: Joi.object({
    name: Joi.string().max(255).required(),
    role: Joi.string().max(100).required(),
    signature: Joi.string().optional()
  }).optional(),

  // Specific details (for medical-specific consents)
  specific_details: Joi.object({
    procedure: Joi.string().max(2000).optional(),
    risks: Joi.string().max(2000).optional(),
    alternatives: Joi.string().max(2000).optional(),
    expected_results: Joi.string().max(2000).optional()
  }).optional(),

  // Related document
  related_document_id: Joi.string().uuid().optional()
});

module.exports.createPractitionerSchema = Joi.object({
  first_name: atomicSchemas.firstName.required(),
  last_name: atomicSchemas.lastName.required(),
  email: atomicSchemas.email.optional(),
  phone: atomicSchemas.phone.optional(),
  license_number: Joi.string().max(50).required(),
  specialty: Joi.string().max(100).optional(),
  qualifications: Joi.array().items(Joi.string()).optional(),
  is_active: atomicSchemas.isActive.default(true),
  notes: atomicSchemas.notes
});

/**
 * Clinic Configuration Validation Schemas
 * Validation pour : healthcare_providers, clinic_settings, clinic_roles
 */

const Joi = require('joi');

// ============================================================================
// HEALTHCARE PROVIDERS (Utilisateurs de la clinique)
// ============================================================================

// Schema pour les créneaux horaires (slots)
const timeSlotSchema = Joi.object({
  start: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required()
    .messages({
      'string.pattern.base': 'Le format de l\'heure de début doit être HH:MM (ex: 09:00) / El formato de hora de inicio debe ser HH:MM (ej: 09:00)'
    }),
  end: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required()
    .messages({
      'string.pattern.base': 'Le format de l\'heure de fin doit être HH:MM (ex: 18:00) / El formato de hora de fin debe ser HH:MM (ej: 18:00)'
    })
});

// Schema pour la disponibilité d'un jour
const dayAvailabilitySchema = Joi.object({
  enabled: Joi.boolean().required(),
  slots: Joi.array().items(timeSlotSchema).default([])
});

// Schema pour la disponibilité hebdomadaire
const weeklyAvailabilitySchema = Joi.object({
  monday: dayAvailabilitySchema.optional(),
  tuesday: dayAvailabilitySchema.optional(),
  wednesday: dayAvailabilitySchema.optional(),
  thursday: dayAvailabilitySchema.optional(),
  friday: dayAvailabilitySchema.optional(),
  saturday: dayAvailabilitySchema.optional(),
  sunday: dayAvailabilitySchema.optional()
});

// CREATE Healthcare Provider
module.exports.createHealthcareProviderSchema = Joi.object({
  // facility_id is optional - will be set from req.clinicId (authentication context)
  facility_id: Joi.string().uuid().optional().messages({
    'string.guid': 'ID d\'établissement invalide / ID de establecimiento inválido'
  }),

  // Identity
  email: Joi.string().email().lowercase().trim().required().messages({
    'any.required': 'L\'email est obligatoire / El email es obligatorio',
    'string.email': 'Format d\'email invalide / Formato de email inválido'
  }),
  password_hash: Joi.string().min(6).optional().messages({
    'string.min': 'Le mot de passe doit contenir au moins 6 caractères / La contraseña debe tener al menos 6 caracteres'
  }),
  send_invitation: Joi.boolean().default(false), // Si true, envoie un email d'invitation au lieu de créer avec mot de passe
  first_name: Joi.string().min(2).max(100).trim().required().messages({
    'any.required': 'Le prénom est obligatoire / El nombre es obligatorio',
    'string.min': 'Le prénom doit contenir au moins 2 caractères / El nombre debe tener al menos 2 caracteres'
  }),
  last_name: Joi.string().min(2).max(100).trim().required().messages({
    'any.required': 'Le nom est obligatoire / Los apellidos son obligatorios',
    'string.min': 'Le nom doit contenir au moins 2 caractères / Los apellidos deben tener al menos 2 caracteres'
  }),
  title: Joi.string().max(50).allow('').optional(), // Dr, Prof, etc.

  // Professional info
  profession: Joi.string().max(100).required().messages({
    'any.required': 'La profession est obligatoire / La profesión es obligatoria'
  }),
  specialties: Joi.array().items(Joi.string()).default([]),
  adeli: Joi.string().max(11).allow('').optional(),
  rpps: Joi.string().max(11).allow('').optional(),
  order_number: Joi.string().max(50).allow('').optional(),

  // Role and permissions
  // Rôles standardisés: physician (médecins), practitioner (autres soignants), secretary, readonly
  // Rôles système: super_admin, admin
  role: Joi.string()
    .valid('super_admin', 'admin', 'physician', 'practitioner', 'secretary', 'readonly')
    .required()
    .messages({
      'any.required': 'Le rôle est obligatoire / El rol es obligatorio',
      'any.only': 'Rôle invalide / Rol inválido'
    }),
  // Rôle administratif cumulable: direction, clinic_admin, hr, billing
  administrative_role: Joi.string()
    .valid('direction', 'clinic_admin', 'hr', 'billing')
    .allow(null, '')
    .optional(),
  permissions: Joi.object().default({}),

  // Contact
  phone: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).allow('').optional(),
  mobile: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).allow('').optional(),

  // Availability
  availability: weeklyAvailabilitySchema.optional(),

  // UI
  color: Joi.string().max(20).default('blue'),

  // Team assignment (for onboarding)
  team_id: Joi.string().uuid().allow(null, '').optional(),

  // Status
  is_active: Joi.boolean().default(true),
  email_verified: Joi.boolean().default(false),
  account_status: Joi.string()
    .valid('pending', 'active', 'suspended', 'locked')
    .default('active')
    .messages({
      'any.only': 'Statut de compte invalide / Estado de cuenta inválido'
    })
});

// UPDATE Healthcare Provider
module.exports.updateHealthcareProviderSchema = Joi.object({
  facility_id: Joi.string().uuid().optional(),

  // Identity (cannot update email after creation usually)
  password_hash: Joi.string().min(6).optional(),
  first_name: Joi.string().min(2).max(100).trim().optional(),
  last_name: Joi.string().min(2).max(100).trim().optional(),
  title: Joi.string().max(50).allow('').optional(),

  // Professional info
  profession: Joi.string().max(100).optional(),
  specialties: Joi.array().items(Joi.string()).optional(),
  adeli: Joi.string().max(11).allow('').optional(),
  rpps: Joi.string().max(11).allow('').optional(),
  order_number: Joi.string().max(50).allow('').optional(),

  // Role and permissions (standardized)
  role: Joi.string()
    .valid('super_admin', 'admin', 'physician', 'practitioner', 'secretary', 'readonly')
    .optional(),
  administrative_role: Joi.string()
    .valid('direction', 'clinic_admin', 'hr', 'billing')
    .allow(null, '')
    .optional(),
  permissions: Joi.object().optional(),

  // Contact
  phone: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).allow('').optional(),
  mobile: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).allow('').optional(),

  // Availability
  availability: weeklyAvailabilitySchema.optional(),

  // UI
  color: Joi.string().max(20).optional(),

  // Status
  is_active: Joi.boolean().optional(),
  email_verified: Joi.boolean().optional()
}).min(1);

// ============================================================================
// CLINIC SETTINGS (Configuration de la clinique)
// ============================================================================

// Schema pour les plages horaires (matin/après-midi ou simple)
const timeRangeSchema = Joi.object({
  start: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required()
    .messages({
      'string.pattern.base': 'Le format de l\'heure doit être HH:MM (ex: 09:00)'
    }),
  end: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required()
    .messages({
      'string.pattern.base': 'Le format de l\'heure doit être HH:MM (ex: 18:00)'
    })
});

// Schema pour les horaires d'ouverture d'un jour
const operatingHoursSchema = Joi.object({
  enabled: Joi.boolean().required(),
  hasLunchBreak: Joi.boolean().default(false),

  // Si hasLunchBreak = false : plage horaire unique
  start: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .when('hasLunchBreak', {
      is: false,
      then: Joi.when('enabled', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional()
      }),
      otherwise: Joi.forbidden()
    }),
  end: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .when('hasLunchBreak', {
      is: false,
      then: Joi.when('enabled', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional()
      }),
      otherwise: Joi.forbidden()
    }),

  // Si hasLunchBreak = true : deux plages (matin et après-midi)
  morning: timeRangeSchema.when('hasLunchBreak', {
    is: true,
    then: Joi.when('enabled', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    otherwise: Joi.forbidden()
  }),
  afternoon: timeRangeSchema.when('hasLunchBreak', {
    is: true,
    then: Joi.when('enabled', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    otherwise: Joi.forbidden()
  })
});

// Schema pour la configuration des créneaux
const slotSettingsSchema = Joi.object({
  defaultDuration: Joi.number().integer().min(5).max(480).default(30),
  availableDurations: Joi.array().items(Joi.number().integer().min(5).max(480)).default([15, 20, 30, 45, 60]),
  bufferTime: Joi.number().integer().min(0).max(60).default(5),
  maxAdvanceBooking: Joi.number().integer().min(1).max(365).default(90),
  minAdvanceBooking: Joi.number().integer().min(0).max(72).default(1),
  allowWeekendBooking: Joi.boolean().default(false)
});

// Schema pour une date de fermeture
const closedDateSchema = Joi.object({
  id: Joi.string().uuid().optional(),
  date: Joi.date().iso().required(),
  reason: Joi.string().max(255).required(),
  type: Joi.string().valid('holiday', 'maintenance', 'other').default('other')
});

// Schema pour un type de rendez-vous
const appointmentTypeSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().max(100).required(),
  duration: Joi.number().integer().min(5).max(480).required(),
  color: Joi.string().max(20).default('blue')
});

// Schema pour les notifications
const notificationsSchema = Joi.object({
  patientReminders: Joi.object({
    enabled: Joi.boolean().default(true),
    timeBefore: Joi.array().items(Joi.number().integer()).default([24, 2]),
    methods: Joi.array().items(Joi.string().valid('email', 'sms')).default(['email'])
  }).optional(),
  practitionerReminders: Joi.object({
    enabled: Joi.boolean().default(true),
    timeBefore: Joi.array().items(Joi.number().integer()).default([30]),
    methods: Joi.array().items(Joi.string().valid('email', 'sms')).default(['email'])
  }).optional()
});

// CREATE/UPDATE Clinic Settings
module.exports.clinicSettingsSchema = Joi.object({
  facility_id: Joi.string().uuid().required().messages({
    'any.required': 'L\'établissement est obligatoire / El establecimiento es obligatorio'
  }),

  operating_days: Joi.array()
    .items(Joi.number().integer().min(0).max(6))
    .default([1, 2, 3, 4, 5])
    .messages({
      'array.base': 'Les jours d\'ouverture doivent être un tableau',
      'number.min': 'Les jours doivent être entre 0 (Dimanche) et 6 (Samedi)',
      'number.max': 'Les jours doivent être entre 0 (Dimanche) et 6 (Samedi)'
    }),

  operating_hours: Joi.object({
    monday: operatingHoursSchema.optional(),
    tuesday: operatingHoursSchema.optional(),
    wednesday: operatingHoursSchema.optional(),
    thursday: operatingHoursSchema.optional(),
    friday: operatingHoursSchema.optional(),
    saturday: operatingHoursSchema.optional(),
    sunday: operatingHoursSchema.optional()
  }).optional(),

  slot_settings: slotSettingsSchema.optional(),
  closed_dates: Joi.array().items(closedDateSchema).default([]),
  appointment_types: Joi.array().items(appointmentTypeSchema).optional(),
  notifications: notificationsSchema.optional()
});

// UPDATE Clinic Settings (partial update)
module.exports.updateClinicSettingsSchema = Joi.object({
  operating_days: Joi.array()
    .items(Joi.number().integer().min(0).max(6))
    .optional(),

  operating_hours: Joi.object({
    monday: operatingHoursSchema.optional(),
    tuesday: operatingHoursSchema.optional(),
    wednesday: operatingHoursSchema.optional(),
    thursday: operatingHoursSchema.optional(),
    friday: operatingHoursSchema.optional(),
    saturday: operatingHoursSchema.optional(),
    sunday: operatingHoursSchema.optional()
  }).optional(),

  slot_settings: slotSettingsSchema.optional(),
  closed_dates: Joi.array().items(closedDateSchema).optional(),
  appointment_types: Joi.array().items(appointmentTypeSchema).optional(),
  notifications: notificationsSchema.optional()
}).min(1);

// ============================================================================
// CLINIC ROLES (Rôles personnalisés)
// ============================================================================

// CREATE Clinic Role
module.exports.createClinicRoleSchema = Joi.object({
  facility_id: Joi.string().uuid().required().messages({
    'any.required': 'L\'établissement est obligatoire / El establecimiento es obligatorio'
  }),

  name: Joi.string().min(2).max(100).required().messages({
    'any.required': 'Le nom du rôle est obligatoire / El nombre del rol es obligatorio',
    'string.min': 'Le nom doit contenir au moins 2 caractères / El nombre debe tener al menos 2 caracteres'
  }),

  description: Joi.string().max(500).allow('').optional(),

  level: Joi.number().integer().min(1).max(100).default(50).messages({
    'number.min': 'Le niveau doit être entre 1 et 100 / El nivel debe estar entre 1 y 100',
    'number.max': 'Le niveau doit être entre 1 et 100 / El nivel debe estar entre 1 y 100'
  }),

  is_system_role: Joi.boolean().default(false),

  permissions: Joi.array().items(Joi.string()).default([]).messages({
    'array.base': 'Les permissions doivent être un tableau / Los permisos deben ser un array'
  }),

  color: Joi.string().max(20).default('gray')
});

// UPDATE Clinic Role
module.exports.updateClinicRoleSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  description: Joi.string().max(500).allow('').optional(),
  level: Joi.number().integer().min(1).max(100).optional(),
  permissions: Joi.array().items(Joi.string()).optional(),
  color: Joi.string().max(20).optional()
}).min(1);

// ============================================================================
// MEDICAL FACILITIES (Établissements)
// ============================================================================

// UPDATE Medical Facility Settings (company profile)
module.exports.updateFacilitySchema = Joi.object({
  name: Joi.string().min(2).max(255).optional(),
  facility_type: Joi.string()
    .valid('cabinet', 'clinique', 'hopital', 'centre_sante', 'maison_medicale')
    .optional(),

  // Registration
  finess: Joi.string().max(9).allow('').optional(),
  siret: Joi.string().max(14).allow('').optional(),
  adeli: Joi.string().max(11).allow('').optional(),
  rpps: Joi.string().max(11).allow('').optional(),

  // Contact
  address_line1: Joi.string().max(255).allow('').optional(),
  address_line2: Joi.string().max(255).allow('').optional(),
  postal_code: Joi.string().max(10).allow('').optional(),
  city: Joi.string().max(100).allow('').optional(),
  country: Joi.string().max(2).default('FR'),
  phone: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{8,20}$/).allow('').optional(),
  email: Joi.string().email().allow('').optional(),
  website: Joi.string().uri().allow('').optional(),

  // Medical info
  specialties: Joi.array().items(Joi.string()).optional(),
  services: Joi.array().items(Joi.string()).optional(),

  // Configuration
  timezone: Joi.string().max(50).default('Europe/Paris'),
  language: Joi.string().max(5).default('fr-FR'),

  // Status
  is_active: Joi.boolean().optional()
}).min(1);

// ============================================================================
// QUERY PARAMS
// ============================================================================

module.exports.queryParamsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(255).allow('').optional(),
  role: Joi.string().valid('super_admin', 'admin', 'physician', 'practitioner', 'secretary', 'readonly').optional(),
  is_active: Joi.boolean().optional()
});

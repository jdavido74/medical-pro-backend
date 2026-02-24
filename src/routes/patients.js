/**
 * Patients Routes - Clinic Isolated
 * CRUD operations for patients with clinic-specific database isolation
 * Each request automatically uses req.clinicDb for data access
 *
 * VISIBILITY MODES:
 * - Option B (default): Users with PATIENTS_VIEW_ALL see all patients
 * - Option A (future): Remove PATIENTS_VIEW_ALL to enable care team filtering
 *
 * SECRET MÉDICAL:
 * When care team filtering is active (no PATIENTS_VIEW_ALL),
 * patients are only visible to practitioners in their care team.
 */

const express = require('express');
const Joi = require('joi');
const clinicCrudRoutes = require('../base/clinicCrudRoutes');
const schemas = require('../base/validationSchemas');
const { Op } = require('sequelize');
const { getModel } = require('../base/ModelFactory');
const { logger } = require('../utils/logger');
const { PERMISSIONS } = require('../utils/permissionConstants');
const { getPermissionsFromClinicRoles } = require('../middleware/permissions');

const router = express.Router();

// Validation schema for query
const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(1000).default(20),
  search: Joi.string().max(255).allow('').optional(),
  status: Joi.string().valid('active', 'inactive', 'archived').optional(),
  profile_status: Joi.string().valid('provisional', 'complete').optional(),
  showAll: Joi.boolean().default(false) // Admin only: voir tous les patients
});

// Placeholder names used for provisional patients
const PLACEHOLDER_NAMES = ['À COMPLÉTER', 'A COMPLETAR', 'TO COMPLETE'];

// ============================================================================
// ROUTE POST /provisional - Création rapide de patient provisoire
// Seuls first_name + phone sont requis. last_name = placeholder, email = null
// ============================================================================
router.post('/provisional', async (req, res, next) => {
  try {
    // Validate with provisional schema (only first_name + phone required)
    const { error, value } = schemas.createProvisionalPatientSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    const Patient = await getModel(req.clinicDb, 'Patient');

    // Auto-fill facility_id
    if (!value.facility_id) {
      const [facilities] = await req.clinicDb.query(
        `SELECT id FROM medical_facilities WHERE is_active = true LIMIT 1`
      );
      if (facilities && facilities.length > 0) {
        value.facility_id = facilities[0].id;
      } else if (req.user.companyId) {
        value.facility_id = req.user.companyId;
      } else {
        return res.status(400).json({
          success: false,
          error: { message: 'No facility available for this clinic' }
        });
      }
    }

    // Auto-fill placeholder values for missing fields
    if (!value.last_name) {
      value.last_name = 'À COMPLÉTER';
    }
    // email stays null if not provided (column allows null)

    // Set profile_status to provisional
    value.profile_status = 'provisional';

    // Duplicate check by phone only (not by name, since last_name is placeholder)
    const existingByPhone = await Patient.findOne({
      where: {
        phone: value.phone,
        archived: false
      }
    });

    if (existingByPhone) {
      return res.status(409).json({
        success: false,
        error: {
          message: 'Un patient avec ce numéro de téléphone existe déjà',
          details: 'Duplicate phone number',
          existingPatient: {
            id: existingByPhone.id,
            firstName: existingByPhone.first_name,
            lastName: existingByPhone.last_name,
            patientNumber: existingByPhone.patient_number
          }
        }
      });
    }

    // Create the patient
    const patient = await Patient.create(value);

    logger.info(`✅ Provisional patient created: ${patient.first_name} (${patient.phone})`, {
      patientId: patient.id,
      clinicId: req.user.companyId
    });

    // Auto-add creator to care team (same logic as onAfterCreate)
    try {
      const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
      const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');

      const provider = await HealthcareProvider.findOne({
        where: { central_user_id: req.user.id },
        attributes: ['id']
      });

      if (provider) {
        await PatientCareTeam.findOrCreate({
          where: {
            patient_id: patient.id,
            provider_id: provider.id
          },
          defaults: {
            patient_id: patient.id,
            provider_id: provider.id,
            role: 'primary_physician',
            access_level: 'full',
            granted_at: new Date()
          }
        });
      }
    } catch (careTeamError) {
      logger.error(`Failed to add to care team: ${careTeamError.message}`);
    }

    res.status(201).json({
      success: true,
      data: patient
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ROUTE GET / PERSONNALISÉE - SECRET MÉDICAL
// Filtre les patients par équipe de soins pour les praticiens
// ============================================================================
router.get('/', async (req, res, next) => {
  try {
    // Validation des paramètres
    let params = { page: 1, limit: 20, ...req.query };
    const { error, value } = querySchema.validate(params);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    const { page, limit, search, status, profile_status, showAll } = value;

    // Récupérer les modèles
    const Patient = await getModel(req.clinicDb, 'Patient');
    const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');

    // Déterminer si l'utilisateur peut voir tous les patients
    // Option B: PATIENTS_VIEW_ALL permission = voir tous les patients
    // Option A (future): Retirer PATIENTS_VIEW_ALL = filtrage par équipe de soins
    const userPermissions = await getPermissionsFromClinicRoles(req.user.companyId, req.user.role);
    const canViewAllPatients = userPermissions.includes(PERMISSIONS.PATIENTS_VIEW_ALL) ||
                               req.user.role === 'super_admin';

    // Si l'utilisateur a PATIENTS_VIEW_ALL, pas de filtrage par équipe de soins
    const shouldFilterByCareTeam = !canViewAllPatients;

    logger.debug(`[Patients] Access check for user ${req.user.id}`, {
      role: req.user.role,
      canViewAllPatients,
      shouldFilterByCareTeam
    });

    // Construire le where clause
    const where = {};

    // Filtrer les patients archivés par défaut
    if (status !== 'archived') {
      where.archived = false;
    }

    // Filtrer par profile_status (provisional / complete)
    if (profile_status) {
      where.profile_status = profile_status;
    }

    // SECRET MÉDICAL: Filtrer par équipe de soins pour les praticiens
    if (shouldFilterByCareTeam) {
      // Trouver le healthcare_provider correspondant à l'utilisateur central
      const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
      const provider = await HealthcareProvider.findOne({
        where: { central_user_id: req.user.id },
        attributes: ['id']
      });

      if (!provider) {
        logger.warn(`[Patients] No healthcare provider found for user ${req.user.id}`);
        return res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, pages: 0, hasNextPage: false, hasPrevPage: false },
          meta: { filteredByCareTeam: true, userRole: req.user.role, error: 'no_provider' }
        });
      }

      // Récupérer les IDs des patients accessibles via le provider_id
      const accessiblePatientIds = await PatientCareTeam.getAccessiblePatientIds(provider.id);

      if (accessiblePatientIds.length === 0) {
        // Aucun patient accessible
        return res.json({
          success: true,
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0,
            hasNextPage: false,
            hasPrevPage: false
          },
          meta: {
            filteredByCareTeam: true,
            userRole: req.user.role
          }
        });
      }

      where.id = { [Op.in]: accessiblePatientIds };

      logger.debug(`[Patients] Filtered by care team for user ${req.user.id}`, {
        accessibleCount: accessiblePatientIds.length
      });
    }

    // Recherche par nom/email/téléphone
    if (search) {
      where[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
        { patient_number: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Récupérer les patients avec pagination
    const offset = (page - 1) * limit;
    const { count, rows } = await Patient.findAndCountAll({
      where,
      limit,
      offset,
      order: [['last_name', 'ASC'], ['first_name', 'ASC']],
      subQuery: false
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
        hasNextPage: page < Math.ceil(count / limit),
        hasPrevPage: page > 1
      },
      meta: {
        filteredByCareTeam: shouldFilterByCareTeam,
        userRole: req.user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ROUTE GET /:id - Vérification accès patient individuel
// ============================================================================
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const Patient = await getModel(req.clinicDb, 'Patient');
    const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');

    // Vérifier les permissions de l'utilisateur
    // Option B: PATIENTS_VIEW_ALL = accès à tous les patients
    // Option A (future): Sans PATIENTS_VIEW_ALL = filtrage par équipe de soins
    const userPermissions = await getPermissionsFromClinicRoles(req.user.companyId, req.user.role);
    const canViewAllPatients = userPermissions.includes(PERMISSIONS.PATIENTS_VIEW_ALL) ||
                               req.user.role === 'super_admin';

    let hasAccess = canViewAllPatients;

    // Si pas d'accès global, vérifier l'équipe de soins
    if (!hasAccess) {
      const provider = await HealthcareProvider.findOne({
        where: { central_user_id: req.user.id },
        attributes: ['id']
      });
      hasAccess = provider && await PatientCareTeam.hasAccess(provider.id, id);
    }

    if (!hasAccess) {
      logger.warn(`[Patients] Access denied to patient ${id} for user ${req.user.id}`);
      return res.status(403).json({
        success: false,
        error: {
          message: 'Access denied',
          details: 'You do not have access to this patient. Request access from the care team.'
        }
      });
    }

    const patient = await Patient.findByPk(id);

    if (!patient) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Patient not found'
        }
      });
    }

    res.json({
      success: true,
      data: patient
    });
  } catch (error) {
    next(error);
  }
});

// Generate clinic-aware CRUD routes
// All queries use req.clinicDb (clinic-specific database)
const patientRoutes = clinicCrudRoutes('Patient', {
  createSchema: schemas.createPatientSchema,
  updateSchema: schemas.updatePatientSchema,
  querySchema,
  displayName: 'Patient',
  searchFields: ['first_name', 'last_name', 'email', 'phone', 'patient_number'],

  // Permission configuration - uses clinic_roles as source of truth
  permissions: {
    view: PERMISSIONS.PATIENTS_VIEW,
    create: PERMISSIONS.PATIENTS_CREATE,
    update: PERMISSIONS.PATIENTS_EDIT,
    delete: PERMISSIONS.PATIENTS_DELETE
  },

  // Business logic hooks
  onBeforeCreate: async (data, user, clinicDb) => {
    // Import models for this clinic
    const { getModel } = require('../base/ModelFactory');
    const Patient = await getModel(clinicDb, 'Patient');

    // Récupérer le facility_id depuis la base clinique si non fourni
    if (!data.facility_id) {
      try {
        // Requête directe pour récupérer la première facility active
        const [facilities] = await clinicDb.query(
          `SELECT id FROM medical_facilities WHERE is_active = true LIMIT 1`
        );

        if (facilities && facilities.length > 0) {
          data.facility_id = facilities[0].id;
          console.log(`[Patients] ✅ Facility ID récupéré automatiquement: ${facilities[0].id}`);
        } else {
          // Si pas de facility, utiliser le company_id de l'utilisateur (architecture 1:1)
          if (user.companyId) {
            data.facility_id = user.companyId;
            console.log(`[Patients] ⚠️ Aucune facility trouvée, utilisation du company_id: ${user.companyId}`);
          } else {
            throw new Error('Aucune facility disponible pour cette clinique. Veuillez configurer votre établissement.');
          }
        }
      } catch (facilityError) {
        console.error('[Patients] Erreur récupération facility:', facilityError.message);
        // Fallback sur company_id
        if (user.companyId) {
          data.facility_id = user.companyId;
        } else {
          throw new Error('Configuration de l\'établissement requise. Contactez votre administrateur.');
        }
      }
    }

    // Map date_of_birth to birth_date if provided (backward compatibility)
    if (data.date_of_birth && !data.birth_date) {
      data.birth_date = data.date_of_birth;
      delete data.date_of_birth;
    }

    // Check for duplicates by email + name (clinic-isolated check)
    // Note: Clinic DBs use 'archived' instead of 'deleted_at'
    // Skip name-based duplicate check when last_name is a placeholder
    const isPlaceholderName = PLACEHOLDER_NAMES.includes(data.last_name);

    if (data.email || (data.first_name && data.last_name && !isPlaceholderName)) {
      const orConditions = [];
      if (data.email) {
        orConditions.push({ email: data.email });
      }
      if (data.first_name && data.last_name && !isPlaceholderName) {
        orConditions.push({
          [Op.and]: [
            { first_name: data.first_name },
            { last_name: data.last_name }
          ]
        });
      }

      if (orConditions.length > 0) {
        const existing = await Patient.findOne({
          where: {
            [Op.or]: orConditions,
            archived: false
          }
        });

        if (existing) {
          throw new Error('Patient with this email or name already exists in this clinic');
        }
      }
    }

    return data;
  },

  onAfterCreate: async (patient, user, clinicDb) => {
    const { getModel } = require('../base/ModelFactory');

    logger.info(`✅ Patient created: ${patient.first_name} ${patient.last_name}`, {
      patientId: patient.id,
      clinicId: user.companyId
    });

    // Ajouter automatiquement le praticien créateur à l'équipe de soins du patient
    try {
      const HealthcareProvider = await getModel(clinicDb, 'HealthcareProvider');
      const PatientCareTeam = await getModel(clinicDb, 'PatientCareTeam');

      // Trouver le provider correspondant à l'utilisateur
      const provider = await HealthcareProvider.findOne({
        where: { central_user_id: user.id },
        attributes: ['id']
      });

      if (provider) {
        // Ajouter le praticien comme médecin principal du patient
        await PatientCareTeam.findOrCreate({
          where: {
            patient_id: patient.id,
            provider_id: provider.id
          },
          defaults: {
            patient_id: patient.id,
            provider_id: provider.id,
            role: 'primary_physician',
            access_level: 'full',
            granted_at: new Date()
          }
        });
        logger.info(`✅ Provider ${provider.id} added to care team for patient ${patient.id}`);
      } else {
        logger.warn(`⚠️ No healthcare provider found for user ${user.id}, patient not added to care team`);
      }
    } catch (careTeamError) {
      // Log but don't fail the patient creation
      logger.error(`Failed to add to care team: ${careTeamError.message}`);
    }
  },

  onBeforeUpdate: async (data, existingRecord, user, clinicDb) => {
    // Auto-transition: provisional → complete when all required fields are filled
    if (existingRecord && existingRecord.profile_status === 'provisional') {
      // Merge existing data with incoming update to check completeness
      const merged = {
        first_name: data.first_name || existingRecord.first_name,
        last_name: data.last_name || existingRecord.last_name,
        email: data.email || existingRecord.email,
        phone: data.phone || existingRecord.phone
      };

      const hasFirstName = merged.first_name && merged.first_name.trim().length >= 2;
      const hasLastName = merged.last_name && merged.last_name.trim().length >= 2 &&
        !PLACEHOLDER_NAMES.includes(merged.last_name.trim());
      const hasEmail = merged.email && merged.email.trim().length > 0;
      const hasPhone = merged.phone && merged.phone.trim().length > 0;

      if (hasFirstName && hasLastName && hasEmail && hasPhone) {
        data.profile_status = 'complete';
        logger.info(`✅ Patient ${existingRecord.id} auto-transitioned from provisional to complete`);
      }
    }

    // Prevent complete → provisional transition (one-way only)
    if (data.profile_status === 'provisional' && existingRecord && existingRecord.profile_status === 'complete') {
      delete data.profile_status;
    }

    return data;
  }
});

router.use('/', patientRoutes);

module.exports = router;

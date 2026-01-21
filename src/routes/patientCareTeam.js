/**
 * Patient Care Team Routes
 *
 * Gestion des équipes de soins pour le secret médical.
 * Permet de contrôler quel praticien a accès à quel patient.
 */

const express = require('express');
const Joi = require('joi');
const { getModel } = require('../base/ModelFactory');
const { logger } = require('../utils/logger');

const router = express.Router();

// ============================================================================
// HELPER: Récupérer le provider_id à partir du central_user_id
// ============================================================================
async function getProviderIdFromUser(clinicDb, centralUserId) {
  const HealthcareProvider = await getModel(clinicDb, 'HealthcareProvider');
  const provider = await HealthcareProvider.findOne({
    where: { central_user_id: centralUserId },
    attributes: ['id']
  });
  return provider?.id || null;
}

// ============================================================================
// SCHÉMAS DE VALIDATION
// ============================================================================

const grantAccessSchema = Joi.object({
  patientId: Joi.string().uuid().required(),
  providerId: Joi.string().uuid().required(),
  role: Joi.string().valid('primary_physician', 'specialist', 'nurse', 'care_team_member', 'temporary_access').default('care_team_member'),
  accessLevel: Joi.string().valid('full', 'read_only', 'limited', 'emergency').default('full'),
  expiresAt: Joi.date().iso().allow(null).optional(),
  notes: Joi.string().max(1000).allow('', null).optional()
});

const revokeAccessSchema = Joi.object({
  patientId: Joi.string().uuid().required(),
  providerId: Joi.string().uuid().required(),
  reason: Joi.string().max(500).allow('', null).optional()
});

const updateAccessSchema = Joi.object({
  role: Joi.string().valid('primary_physician', 'specialist', 'nurse', 'care_team_member', 'temporary_access').optional(),
  accessLevel: Joi.string().valid('full', 'read_only', 'limited', 'emergency').optional(),
  expiresAt: Joi.date().iso().allow(null).optional(),
  notes: Joi.string().max(1000).allow('', null).optional()
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /care-team/patient/:patientId
 * Récupère l'équipe de soins d'un patient
 */
router.get('/patient/:patientId', async (req, res, next) => {
  try {
    const { patientId } = req.params;
    const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');

    // Permettre aux admins de voir
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

    // Vérifier que le demandeur a accès à ce patient (via provider_id)
    let hasAccess = false;
    if (!isAdmin) {
      const providerId = await getProviderIdFromUser(req.clinicDb, req.user.id);
      hasAccess = providerId && await PatientCareTeam.hasAccess(providerId, patientId);
    }

    if (!hasAccess && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Access denied',
          details: 'You do not have access to this patient\'s care team'
        }
      });
    }

    // Récupérer l'équipe de soins
    const careTeam = await PatientCareTeam.getCareTeam(patientId);

    // Enrichir avec les infos des praticiens
    const providerIds = careTeam.map(ct => ct.provider_id);
    const providers = await HealthcareProvider.findAll({
      where: { id: providerIds },
      attributes: ['id', 'first_name', 'last_name', 'email', 'specialty', 'role']
    });

    const providersMap = new Map(providers.map(p => [p.id, p]));

    const enrichedCareTeam = careTeam.map(ct => ({
      id: ct.id,
      patientId: ct.patient_id,
      providerId: ct.provider_id,
      provider: providersMap.get(ct.provider_id) || null,
      role: ct.role,
      accessLevel: ct.access_level,
      grantedAt: ct.granted_at,
      grantedBy: ct.granted_by,
      expiresAt: ct.expires_at,
      isTemporary: ct.isTemporary(),
      notes: ct.notes
    }));

    res.json({
      success: true,
      data: enrichedCareTeam
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /care-team/provider/:providerId/patients
 * Récupère tous les patients accessibles par un praticien
 */
router.get('/provider/:providerId/patients', async (req, res, next) => {
  try {
    const { providerId } = req.params;

    // Seul le praticien lui-même ou un admin peut voir cette liste
    const userProviderId = await getProviderIdFromUser(req.clinicDb, req.user.id);
    const isOwnList = userProviderId === providerId;
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

    if (!isOwnList && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Access denied',
          details: 'You can only view your own patient access list'
        }
      });
    }

    const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');
    const Patient = await getModel(req.clinicDb, 'Patient');

    const patientIds = await PatientCareTeam.getAccessiblePatientIds(providerId);

    const patients = await Patient.findAll({
      where: {
        id: patientIds,
        archived: false
      },
      attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'birth_date', 'patient_number'],
      order: [['last_name', 'ASC'], ['first_name', 'ASC']]
    });

    res.json({
      success: true,
      data: patients,
      meta: {
        total: patients.length,
        providerId
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /care-team/my-patients
 * Récupère les patients accessibles par l'utilisateur courant
 */
router.get('/my-patients', async (req, res, next) => {
  try {
    const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');
    const Patient = await getModel(req.clinicDb, 'Patient');

    // Utiliser le provider_id, pas le central user id
    const providerId = await getProviderIdFromUser(req.clinicDb, req.user.id);
    if (!providerId) {
      return res.json({
        success: true,
        data: [],
        meta: { total: 0, error: 'no_provider' }
      });
    }

    const patientIds = await PatientCareTeam.getAccessiblePatientIds(providerId);

    const patients = await Patient.findAll({
      where: {
        id: patientIds,
        archived: false
      },
      order: [['last_name', 'ASC'], ['first_name', 'ASC']]
    });

    res.json({
      success: true,
      data: patients,
      meta: {
        total: patients.length
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /care-team/grant
 * Accorde l'accès à un praticien pour un patient
 */
router.post('/grant', async (req, res, next) => {
  try {
    // Validation
    const { error, value } = grantAccessSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    const { patientId, providerId, role, accessLevel, expiresAt, notes } = value;
    const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');

    // Vérifier que le demandeur a le droit d'accorder l'accès
    // Soit admin, soit membre de l'équipe avec accès full et rôle élevé
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

    // Utiliser le provider_id pour vérifier l'accès
    const requesterProviderId = await getProviderIdFromUser(req.clinicDb, req.user.id);
    const requesterAccess = requesterProviderId
      ? await PatientCareTeam.hasAccess(requesterProviderId, patientId)
      : null;

    const canGrant = isAdmin ||
      (requesterAccess &&
        requesterAccess.access_level === 'full' &&
        ['primary_physician', 'specialist'].includes(requesterAccess.role));

    if (!canGrant) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Access denied',
          details: 'You do not have permission to grant access to this patient'
        }
      });
    }

    // Vérifier que le patient existe
    const Patient = await getModel(req.clinicDb, 'Patient');
    const patient = await Patient.findByPk(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Patient not found'
        }
      });
    }

    // Vérifier que le praticien existe
    const HealthcareProvider = await getModel(req.clinicDb, 'HealthcareProvider');
    const provider = await HealthcareProvider.findByPk(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Provider not found'
        }
      });
    }

    // Accorder l'accès
    const access = await PatientCareTeam.grantAccess({
      patientId,
      providerId,
      role,
      accessLevel,
      grantedBy: req.user.id,
      expiresAt,
      notes
    });

    logger.info('Care team access granted', {
      patientId,
      providerId,
      role,
      accessLevel,
      grantedBy: req.user.id
    });

    res.status(201).json({
      success: true,
      data: access,
      message: `Access granted to ${provider.first_name} ${provider.last_name} for patient ${patient.first_name} ${patient.last_name}`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /care-team/revoke
 * Révoque l'accès d'un praticien à un patient
 */
router.post('/revoke', async (req, res, next) => {
  try {
    // Validation
    const { error, value } = revokeAccessSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    const { patientId, providerId, reason } = value;
    const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');

    // Vérifier que le demandeur a le droit de révoquer l'accès
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

    // Utiliser le provider_id pour vérifier l'accès
    const requesterProviderId = await getProviderIdFromUser(req.clinicDb, req.user.id);
    const requesterAccess = requesterProviderId
      ? await PatientCareTeam.hasAccess(requesterProviderId, patientId)
      : null;

    const canRevoke = isAdmin ||
      (requesterAccess &&
        requesterAccess.access_level === 'full' &&
        ['primary_physician'].includes(requesterAccess.role));

    if (!canRevoke) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Access denied',
          details: 'You do not have permission to revoke access to this patient'
        }
      });
    }

    // Empêcher la révocation de son propre accès si c'est le médecin principal
    if (providerId === requesterProviderId && requesterAccess?.role === 'primary_physician') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Cannot revoke own access',
          details: 'Primary physician cannot revoke their own access. Transfer primary role first.'
        }
      });
    }

    // Révoquer l'accès
    const revoked = await PatientCareTeam.revokeAccess({
      patientId,
      providerId,
      revokedBy: req.user.id,
      reason
    });

    if (!revoked) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Access not found',
          details: 'No active access found for this provider and patient'
        }
      });
    }

    logger.info('Care team access revoked', {
      patientId,
      providerId,
      revokedBy: req.user.id,
      reason
    });

    res.json({
      success: true,
      data: revoked,
      message: 'Access revoked successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /care-team/:accessId
 * Met à jour un accès existant
 */
router.put('/:accessId', async (req, res, next) => {
  try {
    const { accessId } = req.params;

    // Validation
    const { error, value } = updateAccessSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation Error',
          details: error.details.map(d => d.message).join(', ')
        }
      });
    }

    const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');

    // Trouver l'accès
    const access = await PatientCareTeam.findByPk(accessId);
    if (!access || access.revoked_at) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Access not found'
        }
      });
    }

    // Vérifier les permissions
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

    // Utiliser le provider_id pour vérifier l'accès
    const requesterProviderId = await getProviderIdFromUser(req.clinicDb, req.user.id);
    const requesterAccess = requesterProviderId
      ? await PatientCareTeam.hasAccess(requesterProviderId, access.patient_id)
      : null;

    const canUpdate = isAdmin ||
      (requesterAccess &&
        requesterAccess.access_level === 'full' &&
        ['primary_physician'].includes(requesterAccess.role));

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Access denied',
          details: 'You do not have permission to update this access'
        }
      });
    }

    // Mettre à jour
    await access.update(value);

    logger.info('Care team access updated', {
      accessId,
      updates: value,
      updatedBy: req.user.id
    });

    res.json({
      success: true,
      data: access,
      message: 'Access updated successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /care-team/check/:patientId
 * Vérifie si l'utilisateur courant a accès à un patient
 */
router.get('/check/:patientId', async (req, res, next) => {
  try {
    const { patientId } = req.params;
    const PatientCareTeam = await getModel(req.clinicDb, 'PatientCareTeam');

    // Utiliser le provider_id pour vérifier l'accès
    const providerId = await getProviderIdFromUser(req.clinicDb, req.user.id);
    const access = providerId
      ? await PatientCareTeam.hasAccess(providerId, patientId)
      : null;
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

    res.json({
      success: true,
      data: {
        hasAccess: !!access || isAdmin,
        accessLevel: access?.access_level || (isAdmin ? 'admin' : null),
        role: access?.role || (isAdmin ? 'admin' : null),
        isAdmin
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

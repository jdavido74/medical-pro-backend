/**
 * Healthcare Providers Routes
 * Gestion des utilisateurs de la clinique (praticiens, infirmiers, secrétaires, etc.)
 *
 * IMPORTANT: Healthcare providers sont créés dans la base clinique.
 * Une entrée dans user_clinic_memberships (base centrale) permet l'authentification.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const {
  createHealthcareProviderSchema,
  updateHealthcareProviderSchema,
  queryParamsSchema
} = require('../base/clinicConfigSchemas');
const { authMiddleware } = require('../middleware/auth');
const { clinicRoutingMiddleware } = require('../middleware/clinicRouting');
const { UserClinicMembership, Company, User, sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const emailService = require('../services/emailService');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

/**
 * GET /api/v1/healthcare-providers
 * List all healthcare providers for the clinic
 * By default excludes deleted providers unless include_deleted=true
 */
router.get('/', async (req, res) => {
  try {
    const { error, value } = queryParamsSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    const { page = 1, limit = 100, search = '', role, is_active, include_deleted } = value;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereConditions = [];
    const replacements = { limit, offset };

    // Exclude deleted by default
    if (!include_deleted) {
      whereConditions.push(`(account_status IS NULL OR account_status != 'deleted')`);
    }

    if (search) {
      whereConditions.push(`(
        first_name ILIKE :search OR
        last_name ILIKE :search OR
        email ILIKE :search OR
        profession ILIKE :search
      )`);
      replacements.search = `%${search}%`;
    }

    if (role) {
      whereConditions.push('role = :role');
      replacements.role = role;
    }

    if (is_active !== undefined) {
      whereConditions.push('is_active = :is_active');
      replacements.is_active = is_active;
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Query providers
    const [providers] = await req.clinicDb.query(`
      SELECT
        id, facility_id, email, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        is_active, email_verified, account_status, last_login, created_at, updated_at,
        deleted_at, deleted_by, reassigned_to
      FROM healthcare_providers
      ${whereClause}
      ORDER BY last_name, first_name
      LIMIT :limit OFFSET :offset
    `, { replacements });

    // Count total
    const [countResult] = await req.clinicDb.query(`
      SELECT COUNT(*) as total
      FROM healthcare_providers
      ${whereClause}
    `, { replacements: { ...replacements, limit: undefined, offset: undefined } });

    const total = parseInt(countResult[0].total);

    res.json({
      success: true,
      data: providers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('[healthcareProviders] Error fetching providers:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch healthcare providers', details: error.message }
    });
  }
});

/**
 * GET /api/v1/healthcare-providers/:id
 * Get single healthcare provider
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [providers] = await req.clinicDb.query(`
      SELECT
        id, facility_id, email, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        is_active, email_verified, account_status, last_login, created_at, updated_at
      FROM healthcare_providers
      WHERE id = :id
    `, { replacements: { id } });

    if (providers.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Healthcare provider not found' }
      });
    }

    res.json({
      success: true,
      data: providers[0]
    });
  } catch (error) {
    console.error('[healthcareProviders] Error fetching provider:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch healthcare provider', details: error.message }
    });
  }
});

/**
 * POST /api/v1/healthcare-providers
 * Create new healthcare provider
 *
 * Creates:
 * 1. Healthcare provider in clinic database (with password)
 * 2. Membership entry in central database (for multi-clinic auth lookup)
 *
 * Authorization:
 * - Only super_admin and admin can create users
 * - super_admin can assign any role
 * - admin can assign any role except super_admin
 */
router.post('/', async (req, res) => {
  try {
    // ============================================================
    // AUTHORIZATION CHECK: Only admin/super_admin can create users
    // ============================================================
    const currentUserRole = req.user?.role;
    const allowedCreatorRoles = ['super_admin', 'admin'];

    if (!allowedCreatorRoles.includes(currentUserRole)) {
      console.warn(`[healthcareProviders] Unauthorized create attempt by role: ${currentUserRole}`);
      return res.status(403).json({
        success: false,
        error: {
          message: 'Accès refusé',
          details: 'Vous n\'avez pas la permission de créer des utilisateurs'
        }
      });
    }

    // Validate request body
    const { error, value } = createHealthcareProviderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    // ============================================================
    // AUTHORIZATION CHECK: Validate role assignment permissions
    // ============================================================
    const requestedRole = value.role;

    // Hierarchy: super_admin > admin > physician > practitioner > secretary > readonly
    const roleHierarchy = {
      'super_admin': 100,
      'admin': 90,
      'physician': 70,
      'practitioner': 50,
      'secretary': 30,
      'readonly': 10
    };

    // super_admin can assign any role
    // admin can assign any role EXCEPT super_admin
    if (currentUserRole === 'admin' && requestedRole === 'super_admin') {
      console.warn(`[healthcareProviders] Admin tried to create super_admin`);
      return res.status(403).json({
        success: false,
        error: {
          message: 'Accès refusé',
          details: 'Seul un super administrateur peut créer un autre super administrateur'
        }
      });
    }

    // Additional check: Cannot assign a role higher than your own (except super_admin who can do anything)
    if (currentUserRole !== 'super_admin') {
      const currentLevel = roleHierarchy[currentUserRole] || 0;
      const requestedLevel = roleHierarchy[requestedRole] || 0;

      if (requestedLevel > currentLevel) {
        console.warn(`[healthcareProviders] User ${currentUserRole} tried to assign higher role ${requestedRole}`);
        return res.status(403).json({
          success: false,
          error: {
            message: 'Accès refusé',
            details: 'Vous ne pouvez pas attribuer un rôle supérieur au vôtre'
          }
        });
      }
    }

    console.log(`[healthcareProviders] User ${currentUserRole} creating user with role ${requestedRole}`);

    const crypto = require('crypto');
    let hashedPassword = null;
    let invitationToken = null;
    let invitationExpiresAt = null;
    let accountStatus = 'active';

    // Déterminer le mode: invitation ou mot de passe direct
    if (value.send_invitation) {
      // Mode invitation: générer un token
      invitationToken = crypto.randomBytes(32).toString('hex');
      invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours
      accountStatus = 'pending';
      console.log('[healthcareProviders] Creating user with invitation token');
    } else {
      // Mode mot de passe direct: hacher le mot de passe
      if (!value.password_hash) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Validation Error',
            details: 'Le mot de passe est obligatoire si l\'invitation n\'est pas activée / La contraseña es obligatoria si la invitación no está activada'
          }
        });
      }
      hashedPassword = await bcrypt.hash(value.password_hash, 12);
      accountStatus = 'active';
      console.log('[healthcareProviders] Creating user with direct password');
    }

    // ============================================================
    // ÉTAPE 1: Vérifier que l'email n'existe pas déjà dans cette clinique
    // ============================================================
    const [existingProviders] = await req.clinicDb.query(`
      SELECT id FROM healthcare_providers WHERE email = :email
    `, { replacements: { email: value.email.toLowerCase() } });

    if (existingProviders.length > 0) {
      return res.status(409).json({
        success: false,
        error: { message: 'Email already exists in this clinic' }
      });
    }

    // ============================================================
    // ÉTAPE 2: Créer le healthcare provider dans la base CLINIQUE
    // ============================================================
    const [result] = await req.clinicDb.query(`
      INSERT INTO healthcare_providers (
        facility_id, email, password_hash, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        team_id, is_active, email_verified, account_status, invitation_token, invitation_expires_at
      ) VALUES (
        :facility_id, :email, :password_hash, :first_name, :last_name, :title,
        :profession, :specialties, :adeli, :rpps, :order_number,
        :role, :permissions, :phone, :mobile, :availability, :color,
        :team_id, :is_active, :email_verified, :account_status, :invitation_token, :invitation_expires_at
      ) RETURNING
        id, facility_id, email, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        team_id, is_active, email_verified, account_status, created_at, updated_at
    `, {
      replacements: {
        facility_id: req.clinicId,
        email: value.email.toLowerCase(),
        password_hash: hashedPassword,
        first_name: value.first_name,
        last_name: value.last_name,
        title: value.title || null,
        profession: value.profession,
        specialties: JSON.stringify(value.specialties || []),
        adeli: value.adeli || null,
        rpps: value.rpps || null,
        order_number: value.order_number || null,
        role: value.role,
        permissions: JSON.stringify(value.permissions || {}),
        phone: value.phone || null,
        mobile: value.mobile || null,
        availability: JSON.stringify(value.availability || {}),
        color: value.color || 'blue',
        team_id: value.team_id || null,
        is_active: value.is_active !== false,
        email_verified: !value.send_invitation,
        account_status: accountStatus,
        invitation_token: invitationToken,
        invitation_expires_at: invitationExpiresAt
      }
    });

    const createdProvider = result[0];
    console.log('[healthcareProviders] Healthcare provider created in clinic DB:', createdProvider?.id);

    // ============================================================
    // ÉTAPE 2b: Mode mot de passe direct → créer le user central
    // (même logique que POST /auth/set-password pour les invitations)
    // Sans user central, le praticien ne peut pas se connecter.
    // ============================================================
    if (!value.send_invitation && hashedPassword) {
      try {
        const validRoles = ['super_admin', 'admin', 'physician', 'practitioner', 'secretary', 'readonly'];
        const centralRole = validRoles.includes(value.role) ? value.role : 'practitioner';

        // Vérifier si un user central existe déjà avec cet email
        let centralUser = await User.findOne({
          where: { email: value.email.toLowerCase() }
        });

        if (centralUser) {
          // Mettre à jour le user existant
          await centralUser.update({
            password_hash: hashedPassword,
            first_name: value.first_name,
            last_name: value.last_name,
            role: centralRole,
            is_active: true,
            email_verified: true
          });
        } else {
          // Créer le user central
          centralUser = await User.create({
            id: uuidv4(),
            email: value.email.toLowerCase(),
            password_hash: hashedPassword,
            first_name: value.first_name,
            last_name: value.last_name,
            role: centralRole,
            company_id: req.clinicId,
            email_verified: true,
            is_active: true
          });
        }

        // Lier le healthcare_provider au user central
        await req.clinicDb.query(`
          UPDATE healthcare_providers
          SET central_user_id = :central_user_id,
              auth_migrated_to_central = true,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = :provider_id
        `, {
          replacements: {
            central_user_id: centralUser.id,
            provider_id: createdProvider.id
          }
        });

        console.log('[healthcareProviders] Central user created/linked for:', value.email, '→', centralUser.id);
      } catch (centralUserError) {
        console.error('[healthcareProviders] Failed to create central user (non-critical):', centralUserError);
        // Don't fail — provider is created, admin can fix auth later
      }
    }

    // ============================================================
    // ÉTAPE 3: Créer la membership dans la base CENTRALE (pour auth)
    // ============================================================
    try {
      await UserClinicMembership.upsertMembership({
        email: value.email.toLowerCase(),
        companyId: req.clinicId,
        providerId: createdProvider.id,
        roleInClinic: value.role,
        isPrimary: false, // Not primary by default
        displayName: `${value.first_name} ${value.last_name}`.trim(),
        isActive: value.is_active !== false
      });
      console.log('[healthcareProviders] Membership created in central DB for:', value.email);
    } catch (membershipError) {
      console.error('[healthcareProviders] Failed to create membership:', membershipError);
      // Don't fail the request - provider is created, just log the error
    }

    // Si mode invitation, envoyer l'email
    if (value.send_invitation && invitationToken) {
      // Get company locale for invitation link
      const company = await Company.findByPk(req.clinicId);
      const locale = company?.locale || 'fr-FR';
      // Extract language code from locale (e.g., 'fr-FR' -> 'fr', 'es-ES' -> 'es')
      const language = locale.split('-')[0].toLowerCase();
      const invitationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${locale}/set-password?token=${invitationToken}`;
      console.log('[healthcareProviders] Invitation link:', invitationLink);

      // Send invitation email
      try {
        await emailService.sendInvitationEmail({
          email: value.email.toLowerCase(),
          firstName: value.first_name,
          lastName: value.last_name,
          clinicName: company?.name || 'Clinic',
          role: value.role,
          invitationUrl: invitationLink,
          expiresAt: invitationExpiresAt,
          language: language
        });
        console.log('[healthcareProviders] Invitation email sent successfully to:', value.email);
      } catch (emailError) {
        console.error('[healthcareProviders] Failed to send invitation email:', emailError);
        // Don't fail the request - provider is created, just log the error
      }

      res.status(201).json({
        success: true,
        data: {
          ...createdProvider,
          invitation_link: invitationLink // TEMPORAIRE - à retirer en production
        },
        message: 'Utilisateur créé avec succès. Email d\'invitation envoyé.'
      });
    } else {
      res.status(201).json({
        success: true,
        data: createdProvider,
        message: 'Healthcare provider created successfully'
      });
    }
  } catch (error) {
    console.error('[healthcareProviders] Error creating provider:', error);

    if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
      return res.status(409).json({
        success: false,
        error: { message: 'Email already exists' }
      });
    }

    res.status(500).json({
      success: false,
      error: { message: 'Failed to create healthcare provider', details: error.message }
    });
  }
});

/**
 * PUT /api/v1/healthcare-providers/:id
 * Update healthcare provider
 *
 * Authorization for role changes:
 * - Only super_admin and admin can change roles
 * - admin cannot assign super_admin role
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate request body
    const { error, value } = updateHealthcareProviderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

    // ============================================================
    // AUTHORIZATION CHECK: If role is being changed, validate permissions
    // ============================================================
    if (value.role) {
      const currentUserRole = req.user?.role;
      const allowedRoleChangers = ['super_admin', 'admin'];

      if (!allowedRoleChangers.includes(currentUserRole)) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Accès refusé',
            details: 'Vous n\'avez pas la permission de modifier les rôles'
          }
        });
      }

      // admin cannot assign super_admin role
      if (currentUserRole === 'admin' && value.role === 'super_admin') {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Accès refusé',
            details: 'Seul un super administrateur peut attribuer le rôle super administrateur'
          }
        });
      }

      // Prevent self-role-downgrade for protection
      const currentUserId = req.user?.providerId || req.user?.userId;
      if (id === currentUserId && value.role !== currentUserRole) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Action non autorisée',
            details: 'Vous ne pouvez pas modifier votre propre rôle'
          }
        });
      }
    }

    // Build SET clause dynamically
    const updates = [];
    const replacements = { id };

    Object.keys(value).forEach(key => {
      if (key === 'password_hash' && value[key]) {
        // Hash password if provided
        updates.push(`${key} = :${key}`);
        replacements[key] = bcrypt.hashSync(value[key], 10);
      } else if (key === 'specialties' || key === 'permissions' || key === 'availability') {
        // Stringify JSONB fields
        updates.push(`${key} = :${key}`);
        replacements[key] = JSON.stringify(value[key]);
      } else {
        updates.push(`${key} = :${key}`);
        replacements[key] = value[key];
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No fields to update' }
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const [result] = await req.clinicDb.query(`
      UPDATE healthcare_providers
      SET ${updates.join(', ')}
      WHERE id = :id
      RETURNING
        id, facility_id, email, first_name, last_name, title,
        profession, specialties, adeli, rpps, order_number,
        role, permissions, phone, mobile, availability, color,
        is_active, email_verified, last_login, created_at, updated_at
    `, { replacements });

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Healthcare provider not found' }
      });
    }

    res.json({
      success: true,
      data: result[0],
      message: 'Healthcare provider updated successfully'
    });
  } catch (error) {
    console.error('[healthcareProviders] Error updating provider:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update healthcare provider', details: error.message }
    });
  }
});

/**
 * GET /api/v1/healthcare-providers/:id/deletion-stats
 * Get statistics about what will be affected by deleting a provider
 * (patients, future appointments, etc.)
 */
router.get('/:id/deletion-stats', async (req, res) => {
  try {
    const { id } = req.params;

    // Check provider exists
    const [providers] = await req.clinicDb.query(`
      SELECT id, first_name, last_name, email FROM healthcare_providers WHERE id = :id
    `, { replacements: { id } });

    if (providers.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Healthcare provider not found' }
      });
    }

    // Count future appointments
    const [futureAppointments] = await req.clinicDb.query(`
      SELECT COUNT(*) as count
      FROM appointments
      WHERE provider_id = :id
        AND appointment_date >= CURRENT_DATE
        AND status NOT IN ('cancelled', 'completed', 'no_show')
    `, { replacements: { id } });

    // Count patients in care team (primary physician)
    const [patientsInCareTeam] = await req.clinicDb.query(`
      SELECT COUNT(DISTINCT patient_id) as count
      FROM patient_care_team
      WHERE provider_id = :id
        AND (revoked_at IS NULL OR revoked_at > CURRENT_TIMESTAMP)
        AND role = 'primary_physician'
    `, { replacements: { id } });

    // Count total past appointments (for info)
    const [pastAppointments] = await req.clinicDb.query(`
      SELECT COUNT(*) as count
      FROM appointments
      WHERE provider_id = :id
        AND appointment_date < CURRENT_DATE
    `, { replacements: { id } });

    // Count medical records created
    const [medicalRecords] = await req.clinicDb.query(`
      SELECT COUNT(*) as count
      FROM medical_records
      WHERE provider_id = :id OR created_by = :id
    `, { replacements: { id } });

    res.json({
      success: true,
      data: {
        provider: providers[0],
        stats: {
          futureAppointments: parseInt(futureAppointments[0].count),
          patientsAsPrimary: parseInt(patientsInCareTeam[0].count),
          pastAppointments: parseInt(pastAppointments[0].count),
          medicalRecords: parseInt(medicalRecords[0].count)
        }
      }
    });
  } catch (error) {
    console.error('[healthcareProviders] Error getting deletion stats:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get deletion statistics', details: error.message }
    });
  }
});

/**
 * DELETE /api/v1/healthcare-providers/:id
 * Soft delete healthcare provider with optional reassignment
 *
 * Body:
 * - reassign_to: UUID of provider to reassign future appointments and primary patients to
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reassign_to } = req.body || {};
    const deletedBy = req.user?.userId || req.user?.providerId;

    // Check provider exists and is not already deleted
    const [providers] = await req.clinicDb.query(`
      SELECT id, email, first_name, last_name, account_status
      FROM healthcare_providers
      WHERE id = :id
    `, { replacements: { id } });

    if (providers.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Healthcare provider not found' }
      });
    }

    const provider = providers[0];

    if (provider.account_status === 'deleted') {
      return res.status(400).json({
        success: false,
        error: { message: 'This provider is already deleted' }
      });
    }

    // Prevent self-deletion
    if (id === deletedBy) {
      return res.status(403).json({
        success: false,
        error: { message: 'You cannot delete your own account' }
      });
    }

    // If reassignment is specified, verify the target provider exists
    if (reassign_to) {
      const [targetProviders] = await req.clinicDb.query(`
        SELECT id FROM healthcare_providers
        WHERE id = :reassign_to AND is_active = true AND (account_status IS NULL OR account_status != 'deleted')
      `, { replacements: { reassign_to } });

      if (targetProviders.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Target provider for reassignment not found or inactive' }
        });
      }

      // Reassign future appointments
      await req.clinicDb.query(`
        UPDATE appointments
        SET provider_id = :reassign_to, updated_at = CURRENT_TIMESTAMP
        WHERE provider_id = :id
          AND appointment_date >= CURRENT_DATE
          AND status NOT IN ('cancelled', 'completed', 'no_show')
      `, { replacements: { id, reassign_to } });

      // Reassign primary physician role in patient care team
      await req.clinicDb.query(`
        UPDATE patient_care_team
        SET provider_id = :reassign_to, updated_at = CURRENT_TIMESTAMP
        WHERE provider_id = :id
          AND role = 'primary_physician'
          AND (revoked_at IS NULL OR revoked_at > CURRENT_TIMESTAMP)
      `, { replacements: { id, reassign_to } });

      console.log(`[healthcareProviders] Reassigned appointments and patients from ${id} to ${reassign_to}`);
    }

    // Soft delete the provider
    const [result] = await req.clinicDb.query(`
      UPDATE healthcare_providers
      SET
        account_status = 'deleted',
        is_active = false,
        deleted_at = CURRENT_TIMESTAMP,
        deleted_by = :deleted_by,
        reassigned_to = :reassign_to,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
      RETURNING
        id, facility_id, email, first_name, last_name, role, is_active, account_status, deleted_at
    `, { replacements: { id, deleted_by: deletedBy, reassign_to: reassign_to || null } });

    // Deactivate membership in central database
    try {
      await UserClinicMembership.update(
        { is_active: false },
        { where: { provider_id: id, company_id: req.clinicId } }
      );
    } catch (membershipError) {
      console.error('[healthcareProviders] Failed to deactivate membership:', membershipError);
    }

    console.log(`[healthcareProviders] Provider soft-deleted: ${provider.email} by ${deletedBy}`);

    res.json({
      success: true,
      data: result[0],
      message: reassign_to
        ? 'Provider deleted and records reassigned successfully'
        : 'Provider deleted successfully'
    });
  } catch (error) {
    console.error('[healthcareProviders] Error deleting provider:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete healthcare provider', details: error.message }
    });
  }
});

/**
 * POST /api/v1/healthcare-providers/:id/restore
 * Restore a soft-deleted healthcare provider
 */
router.post('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;

    // Check provider exists and is deleted
    const [providers] = await req.clinicDb.query(`
      SELECT id, email, first_name, last_name, account_status
      FROM healthcare_providers
      WHERE id = :id
    `, { replacements: { id } });

    if (providers.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Healthcare provider not found' }
      });
    }

    const provider = providers[0];

    if (provider.account_status !== 'deleted') {
      return res.status(400).json({
        success: false,
        error: { message: 'This provider is not deleted' }
      });
    }

    // Restore the provider
    const [result] = await req.clinicDb.query(`
      UPDATE healthcare_providers
      SET
        account_status = 'active',
        is_active = true,
        deleted_at = NULL,
        deleted_by = NULL,
        reassigned_to = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
      RETURNING
        id, facility_id, email, first_name, last_name, title,
        profession, specialties, role, permissions, phone, mobile,
        is_active, email_verified, account_status, created_at, updated_at
    `, { replacements: { id } });

    // Reactivate membership in central database
    try {
      await UserClinicMembership.update(
        { is_active: true },
        { where: { provider_id: id, company_id: req.clinicId } }
      );
    } catch (membershipError) {
      console.error('[healthcareProviders] Failed to reactivate membership:', membershipError);
    }

    console.log(`[healthcareProviders] Provider restored: ${provider.email}`);

    res.json({
      success: true,
      data: result[0],
      message: 'Provider restored successfully'
    });
  } catch (error) {
    console.error('[healthcareProviders] Error restoring provider:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to restore healthcare provider', details: error.message }
    });
  }
});

/**
 * GET /api/v1/healthcare-providers/deleted
 * List deleted healthcare providers (for admin restore functionality)
 */
router.get('/deleted', async (req, res) => {
  try {
    const [providers] = await req.clinicDb.query(`
      SELECT
        id, facility_id, email, first_name, last_name, title,
        profession, role, is_active, account_status,
        deleted_at, deleted_by, reassigned_to, created_at
      FROM healthcare_providers
      WHERE account_status = 'deleted'
      ORDER BY deleted_at DESC
    `);

    res.json({
      success: true,
      data: providers
    });
  } catch (error) {
    console.error('[healthcareProviders] Error fetching deleted providers:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch deleted providers', details: error.message }
    });
  }
});

module.exports = router;

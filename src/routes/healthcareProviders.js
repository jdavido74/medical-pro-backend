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
const { UserClinicMembership, Company } = require('../models'); // For multi-clinic auth
const emailService = require('../services/emailService');

// Apply middleware
router.use(authMiddleware);
router.use(clinicRoutingMiddleware);

/**
 * GET /api/v1/healthcare-providers
 * List all healthcare providers for the clinic
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

    const { page = 1, limit = 100, search = '', role, is_active } = value;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereConditions = [];
    const replacements = { limit, offset };

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
        is_active, email_verified, account_status, last_login, created_at, updated_at
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
 */
router.post('/', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = createHealthcareProviderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation Error', details: error.details[0].message }
      });
    }

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
 * DELETE /api/v1/healthcare-providers/:id
 * Delete (deactivate) healthcare provider
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await req.clinicDb.query(`
      UPDATE healthcare_providers
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
      RETURNING
        id, facility_id, email, first_name, last_name, role, is_active
    `, { replacements: { id } });

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Healthcare provider not found' }
      });
    }

    res.json({
      success: true,
      data: result[0],
      message: 'Healthcare provider deactivated successfully'
    });
  } catch (error) {
    console.error('[healthcareProviders] Error deleting provider:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete healthcare provider', details: error.message }
    });
  }
});

module.exports = router;

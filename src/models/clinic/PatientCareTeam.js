/**
 * PatientCareTeam Model
 *
 * Gère les équipes de soins pour le secret médical.
 * Un praticien ne peut accéder qu'aux patients dont il fait partie de l'équipe.
 *
 * Rôles possibles:
 * - primary_physician: Médecin traitant principal
 * - specialist: Spécialiste
 * - nurse: Infirmier/ère
 * - care_team_member: Membre de l'équipe (par défaut)
 * - temporary_access: Accès temporaire
 *
 * Niveaux d'accès:
 * - full: Lecture/écriture complète
 * - read_only: Lecture seule
 * - limited: Infos de base uniquement
 * - emergency: Accès d'urgence temporaire
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PatientCareTeam = sequelize.define('PatientCareTeam', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    patient_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'patients',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    provider_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },

    role: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'care_team_member',
      validate: {
        // Care team roles (different from user roles)
        isIn: [['primary_physician', 'referring_physician', 'practitioner', 'care_team_member', 'temporary_access']]
      }
    },

    access_level: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'full',
      validate: {
        isIn: [['full', 'read_only', 'limited', 'emergency']]
      }
    },

    granted_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },

    granted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      }
    },

    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true
    },

    revoked_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'healthcare_providers',
        key: 'id'
      }
    },

    revocation_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'NULL = permanent access'
    },

    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'patient_care_team',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['patient_id', 'provider_id']
      },
      {
        fields: ['patient_id']
      },
      {
        fields: ['provider_id']
      }
    ]
  });

  // ============================================================================
  // MÉTHODES DE CLASSE (Static)
  // ============================================================================

  /**
   * Vérifie si un praticien a accès à un patient
   * @param {string} providerId - ID du praticien
   * @param {string} patientId - ID du patient
   * @returns {Object|null} - L'accès trouvé ou null
   */
  PatientCareTeam.hasAccess = async function(providerId, patientId) {
    const { Op } = require('sequelize');

    return await this.findOne({
      where: {
        provider_id: providerId,
        patient_id: patientId,
        revoked_at: null,
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } }
        ]
      }
    });
  };

  /**
   * Récupère tous les patients accessibles par un praticien
   * @param {string} providerId - ID du praticien
   * @returns {Array<string>} - Liste des IDs de patients
   */
  PatientCareTeam.getAccessiblePatientIds = async function(providerId) {
    const { Op } = require('sequelize');

    const accesses = await this.findAll({
      where: {
        provider_id: providerId,
        revoked_at: null,
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } }
        ]
      },
      attributes: ['patient_id']
    });

    return accesses.map(a => a.patient_id);
  };

  /**
   * Récupère tous les praticiens ayant accès à un patient
   * @param {string} patientId - ID du patient
   * @returns {Array} - Liste des accès avec infos praticien
   */
  PatientCareTeam.getCareTeam = async function(patientId) {
    const { Op } = require('sequelize');

    return await this.findAll({
      where: {
        patient_id: patientId,
        revoked_at: null,
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } }
        ]
      },
      order: [
        ['role', 'ASC'],
        ['granted_at', 'ASC']
      ]
    });
  };

  /**
   * Accorde l'accès à un praticien pour un patient
   * @param {Object} params - Paramètres
   * @returns {Object} - L'accès créé
   */
  PatientCareTeam.grantAccess = async function({ patientId, providerId, role, accessLevel, grantedBy, expiresAt, notes }) {
    // Vérifier si un accès existe déjà (même révoqué)
    const existing = await this.findOne({
      where: {
        patient_id: patientId,
        provider_id: providerId
      }
    });

    if (existing) {
      // Réactiver l'accès existant
      return await existing.update({
        role: role || existing.role,
        access_level: accessLevel || existing.access_level,
        granted_at: new Date(),
        granted_by: grantedBy,
        revoked_at: null,
        revoked_by: null,
        revocation_reason: null,
        expires_at: expiresAt || null,
        notes: notes || existing.notes
      });
    }

    // Créer un nouvel accès
    return await this.create({
      patient_id: patientId,
      provider_id: providerId,
      role: role || 'care_team_member',
      access_level: accessLevel || 'full',
      granted_by: grantedBy,
      expires_at: expiresAt || null,
      notes
    });
  };

  /**
   * Révoque l'accès d'un praticien à un patient
   * @param {Object} params - Paramètres
   * @returns {Object|null} - L'accès révoqué ou null
   */
  PatientCareTeam.revokeAccess = async function({ patientId, providerId, revokedBy, reason }) {
    const access = await this.findOne({
      where: {
        patient_id: patientId,
        provider_id: providerId,
        revoked_at: null
      }
    });

    if (!access) {
      return null;
    }

    return await access.update({
      revoked_at: new Date(),
      revoked_by: revokedBy,
      revocation_reason: reason
    });
  };

  // ============================================================================
  // MÉTHODES D'INSTANCE
  // ============================================================================

  /**
   * Vérifie si l'accès est actif (non révoqué et non expiré)
   */
  PatientCareTeam.prototype.isActive = function() {
    if (this.revoked_at) return false;
    if (this.expires_at && new Date(this.expires_at) < new Date()) return false;
    return true;
  };

  /**
   * Vérifie si l'accès permet l'écriture
   */
  PatientCareTeam.prototype.canWrite = function() {
    return this.isActive() && this.access_level === 'full';
  };

  /**
   * Vérifie si l'accès est temporaire
   */
  PatientCareTeam.prototype.isTemporary = function() {
    return this.expires_at !== null || this.role === 'temporary_access';
  };

  return PatientCareTeam;
};

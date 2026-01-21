/**
 * Permission Constants
 * Définit TOUTES les permissions possibles du système
 * Utilisé pour valider les accès au backend (source de vérité unique)
 *
 * IMPORTANT: Cette liste doit être SYNCHRONISÉE avec le frontend (permissionsStorage.js)
 * Format: module.action (ex: users.view, patients.create)
 */

const PERMISSIONS = {
  // ===== PATIENTS (Données administratives) =====
  PATIENTS_VIEW: 'patients.view',           // Voir ses patients
  PATIENTS_VIEW_ALL: 'patients.view_all',   // Voir patients de tous
  PATIENTS_CREATE: 'patients.create',       // Créer patient
  PATIENTS_EDIT: 'patients.edit',           // Modifier patient
  PATIENTS_DELETE: 'patients.delete',       // Supprimer patient
  PATIENTS_EXPORT: 'patients.export',       // Exporter données patients

  // ===== RENDEZ-VOUS =====
  APPOINTMENTS_VIEW: 'appointments.view',           // Voir ses RDV
  APPOINTMENTS_VIEW_ALL: 'appointments.view_all',   // Voir tous RDV
  APPOINTMENTS_CREATE: 'appointments.create',       // Créer RDV
  APPOINTMENTS_EDIT: 'appointments.edit',           // Modifier RDV
  APPOINTMENTS_DELETE: 'appointments.delete',       // Supprimer RDV
  APPOINTMENTS_CONFIRM: 'appointments.confirm',     // Confirmer RDV
  APPOINTMENTS_VIEW_PRACTITIONER: 'appointments.view_practitioner', // Voir nom praticien

  // ===== DOSSIERS MÉDICAUX (Secret médical - Art. L1110-4 CSP) =====
  MEDICAL_RECORDS_VIEW: 'medical_records.view',     // Voir dossiers
  MEDICAL_RECORDS_CREATE: 'medical_records.create', // Créer dossiers
  MEDICAL_RECORDS_EDIT: 'medical_records.edit',     // Modifier dossiers
  MEDICAL_RECORDS_DELETE: 'medical_records.delete', // Supprimer dossiers
  MEDICAL_RECORDS_VIEW_ALL: 'medical_records.view_all', // Voir tous les dossiers
  MEDICAL_NOTES_CREATE: 'medical_notes.create',     // Créer notes

  // Données médicales spécifiques
  MEDICAL_ANTECEDENTS_VIEW: 'medical.antecedents.view',
  MEDICAL_ANTECEDENTS_EDIT: 'medical.antecedents.edit',
  MEDICAL_PRESCRIPTIONS_VIEW: 'medical.prescriptions.view',
  MEDICAL_PRESCRIPTIONS_CREATE: 'medical.prescriptions.create',
  MEDICAL_ALLERGIES_VIEW: 'medical.allergies.view',
  MEDICAL_ALLERGIES_EDIT: 'medical.allergies.edit',
  MEDICAL_VITALS_VIEW: 'medical.vitals.view',
  MEDICAL_VITALS_EDIT: 'medical.vitals.edit',

  // ===== CONSENTEMENTS =====
  CONSENTS_VIEW: 'consents.view',                   // Voir consentements
  CONSENTS_CREATE: 'consents.create',               // Créer consentements
  CONSENTS_EDIT: 'consents.edit',                   // Modifier consentements
  CONSENTS_DELETE: 'consents.delete',               // Supprimer consentements
  CONSENTS_SIGN: 'consents.sign',                   // Signer consentements
  CONSENTS_REVOKE: 'consents.revoke',               // Révoquer consentements
  CONSENTS_ASSIGN: 'consents.assign',               // Attribuer consentements
  CONSENT_TEMPLATES_VIEW: 'consent_templates.view',
  CONSENT_TEMPLATES_CREATE: 'consent_templates.create',
  CONSENT_TEMPLATES_EDIT: 'consent_templates.edit',
  CONSENT_TEMPLATES_DELETE: 'consent_templates.delete',
  CONSENT_TEMPLATES_MANAGE: 'consent_templates.manage', // Alias legacy

  // ===== FACTURES & DEVIS =====
  INVOICES_VIEW: 'invoices.view',           // Voir factures
  INVOICES_CREATE: 'invoices.create',       // Créer factures
  INVOICES_EDIT: 'invoices.edit',           // Modifier factures
  INVOICES_DELETE: 'invoices.delete',       // Supprimer factures
  INVOICES_SEND: 'invoices.send',           // Envoyer factures
  QUOTES_VIEW: 'quotes.view',               // Voir devis
  QUOTES_CREATE: 'quotes.create',           // Créer devis
  QUOTES_EDIT: 'quotes.edit',               // Modifier devis
  QUOTES_DELETE: 'quotes.delete',           // Supprimer devis
  QUOTES_ACCEPT: 'quotes.accept',           // Accepter devis

  // ===== UTILISATEURS =====
  USERS_VIEW: 'users.view',                 // Voir utilisateurs
  USERS_READ: 'users.read',                 // Alias pour users.view
  USERS_CREATE: 'users.create',             // Créer utilisateurs
  USERS_EDIT: 'users.edit',                 // Modifier utilisateurs
  USERS_UPDATE: 'users.update',             // Alias pour users.edit
  USERS_DELETE: 'users.delete',             // Supprimer utilisateurs
  USERS_PERMISSIONS: 'users.permissions',   // Gérer permissions
  USERS_EXPORT: 'users.export',             // Exporter utilisateurs

  // ===== RÔLES =====
  ROLES_VIEW: 'roles.view',                 // Voir rôles
  ROLES_CREATE: 'roles.create',             // Créer rôles
  ROLES_EDIT: 'roles.edit',                 // Modifier rôles
  ROLES_DELETE: 'roles.delete',             // Supprimer rôles

  // ===== ÉQUIPES & DÉLÉGATIONS =====
  TEAMS_VIEW: 'teams.view',                 // Voir équipes
  TEAMS_READ: 'teams.read',                 // Alias pour teams.view
  TEAMS_CREATE: 'teams.create',             // Créer équipes
  TEAMS_EDIT: 'teams.edit',                 // Modifier équipes
  TEAMS_UPDATE: 'teams.update',             // Alias pour teams.edit
  TEAMS_DELETE: 'teams.delete',             // Supprimer équipes
  TEAMS_EXPORT: 'teams.export',             // Exporter équipes

  DELEGATIONS_VIEW: 'delegations.view',
  DELEGATIONS_CREATE: 'delegations.create',
  DELEGATIONS_EDIT: 'delegations.edit',
  DELEGATIONS_APPROVE: 'delegations.approve',
  DELEGATIONS_REVOKE: 'delegations.revoke',

  // ===== ADMINISTRATION =====
  COMPANY_VIEW: 'company.view',             // Voir infos entreprise
  COMPANY_EDIT: 'company.edit',             // Modifier infos entreprise
  SETTINGS_VIEW: 'settings.view',           // Voir paramètres
  SETTINGS_EDIT: 'settings.edit',           // Modifier paramètres
  SETTINGS_CLINIC: 'settings.clinic',       // Paramètres clinique
  SETTINGS_SECURITY: 'settings.security',   // Paramètres sécurité

  // ===== AUDIT & LOGS =====
  AUDIT_VIEW: 'audit.view',                 // Voir logs d'audit
  AUDIT_READ: 'audit.read',                 // Alias pour audit.view
  AUDIT_EXPORT: 'audit.export',             // Exporter logs d'audit
  AUDIT_MANAGE: 'audit.manage',             // Gérer audit
  AUDIT_DELETE: 'audit.delete',             // Supprimer logs (super_admin only)

  // ===== SYSTÈME =====
  SYSTEM_SETTINGS: 'system.settings',
  SYSTEM_BACKUP: 'system.backup',
  SYSTEM_AUDIT: 'system.audit',

  // ===== ANALYTICS =====
  ANALYTICS_VIEW: 'analytics.view',         // Voir statistiques
  ANALYTICS_EXPORT: 'analytics.export',     // Exporter statistiques
  ANALYTICS_ADMIN: 'analytics.admin',       // Stats admin
  ANALYTICS_MEDICAL: 'analytics.medical'    // Stats médicales
};

/**
 * Rôles par défaut avec leurs permissions
 * SYNCHRONISÉ avec le frontend (permissionsStorage.js)
 */
const ROLE_PERMISSIONS = {
  super_admin: [
    // Super admin: TOUS les accès
    ...Object.values(PERMISSIONS)
  ],

  admin: [
    // Admin: Gestion complète de la clinique (SANS données médicales - secret médical)
    // Patients - Données administratives
    PERMISSIONS.PATIENTS_VIEW,
    PERMISSIONS.PATIENTS_VIEW_ALL,
    PERMISSIONS.PATIENTS_CREATE,
    PERMISSIONS.PATIENTS_EDIT,
    PERMISSIONS.PATIENTS_DELETE,
    PERMISSIONS.PATIENTS_EXPORT,

    // Rendez-vous
    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_VIEW_ALL,
    PERMISSIONS.APPOINTMENTS_CREATE,
    PERMISSIONS.APPOINTMENTS_EDIT,
    PERMISSIONS.APPOINTMENTS_DELETE,
    PERMISSIONS.APPOINTMENTS_VIEW_PRACTITIONER,

    // PAS DE DONNÉES MÉDICALES (Secret médical - Art. L1110-4 CSP)

    // Consentements - Gestion administrative
    PERMISSIONS.CONSENTS_VIEW,
    PERMISSIONS.CONSENTS_ASSIGN,
    PERMISSIONS.CONSENT_TEMPLATES_VIEW,
    PERMISSIONS.CONSENT_TEMPLATES_CREATE,
    PERMISSIONS.CONSENT_TEMPLATES_EDIT,
    PERMISSIONS.CONSENT_TEMPLATES_DELETE,
    PERMISSIONS.CONSENT_TEMPLATES_MANAGE,

    // Factures et devis
    PERMISSIONS.INVOICES_VIEW,
    PERMISSIONS.INVOICES_CREATE,
    PERMISSIONS.INVOICES_EDIT,
    PERMISSIONS.INVOICES_DELETE,
    PERMISSIONS.INVOICES_SEND,
    PERMISSIONS.QUOTES_VIEW,
    PERMISSIONS.QUOTES_CREATE,
    PERMISSIONS.QUOTES_EDIT,
    PERMISSIONS.QUOTES_DELETE,

    // Analytics
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,

    // Gestion des utilisateurs
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_EDIT,
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.USERS_DELETE,
    PERMISSIONS.USERS_PERMISSIONS,
    PERMISSIONS.USERS_EXPORT,

    // Gestion des rôles
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.ROLES_CREATE,
    PERMISSIONS.ROLES_EDIT,
    PERMISSIONS.ROLES_DELETE,

    // Équipes et délégations
    PERMISSIONS.TEAMS_VIEW,
    PERMISSIONS.TEAMS_READ,
    PERMISSIONS.TEAMS_CREATE,
    PERMISSIONS.TEAMS_EDIT,
    PERMISSIONS.TEAMS_UPDATE,
    PERMISSIONS.TEAMS_DELETE,
    PERMISSIONS.TEAMS_EXPORT,
    PERMISSIONS.DELEGATIONS_VIEW,
    PERMISSIONS.DELEGATIONS_CREATE,
    PERMISSIONS.DELEGATIONS_EDIT,
    PERMISSIONS.DELEGATIONS_APPROVE,
    PERMISSIONS.DELEGATIONS_REVOKE,

    // Audit
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_EXPORT,

    // Administration
    PERMISSIONS.COMPANY_VIEW,
    PERMISSIONS.COMPANY_EDIT,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_EDIT,
    PERMISSIONS.SETTINGS_CLINIC
  ],

  physician: [
    // Médecin: Accès complet aux données médicales de ses patients
    PERMISSIONS.PATIENTS_VIEW,
    PERMISSIONS.PATIENTS_CREATE,
    PERMISSIONS.PATIENTS_EDIT,

    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_VIEW_ALL,
    PERMISSIONS.APPOINTMENTS_CREATE,
    PERMISSIONS.APPOINTMENTS_EDIT,
    PERMISSIONS.APPOINTMENTS_DELETE,
    PERMISSIONS.APPOINTMENTS_CONFIRM,

    // DONNÉES MÉDICALES COMPLÈTES
    PERMISSIONS.MEDICAL_RECORDS_VIEW,
    PERMISSIONS.MEDICAL_RECORDS_CREATE,
    PERMISSIONS.MEDICAL_RECORDS_EDIT,
    PERMISSIONS.MEDICAL_NOTES_CREATE,
    PERMISSIONS.MEDICAL_ANTECEDENTS_VIEW,
    PERMISSIONS.MEDICAL_ANTECEDENTS_EDIT,
    PERMISSIONS.MEDICAL_PRESCRIPTIONS_VIEW,
    PERMISSIONS.MEDICAL_PRESCRIPTIONS_CREATE,
    PERMISSIONS.MEDICAL_ALLERGIES_VIEW,
    PERMISSIONS.MEDICAL_ALLERGIES_EDIT,
    PERMISSIONS.MEDICAL_VITALS_VIEW,
    PERMISSIONS.MEDICAL_VITALS_EDIT,

    // Consentements
    PERMISSIONS.CONSENTS_VIEW,
    PERMISSIONS.CONSENTS_CREATE,
    PERMISSIONS.CONSENTS_EDIT,
    PERMISSIONS.CONSENTS_SIGN,
    PERMISSIONS.CONSENTS_REVOKE,
    PERMISSIONS.CONSENT_TEMPLATES_VIEW,

    // Devis uniquement
    PERMISSIONS.QUOTES_VIEW,
    PERMISSIONS.QUOTES_CREATE,
    PERMISSIONS.QUOTES_EDIT,

    // Analytics médicales
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_MEDICAL,

    // Équipes
    PERMISSIONS.TEAMS_VIEW,
    PERMISSIONS.DELEGATIONS_VIEW,
    PERMISSIONS.DELEGATIONS_CREATE,

    // Paramètres
    PERMISSIONS.SETTINGS_VIEW
  ],

  practitioner: [
    // Praticien de santé: Accès aux données patients et médicales
    // Option B (clinic-wide): Accès complet aux patients de la clinique
    PERMISSIONS.PATIENTS_VIEW,
    PERMISSIONS.PATIENTS_CREATE,
    PERMISSIONS.PATIENTS_EDIT,
    PERMISSIONS.PATIENTS_VIEW_ALL,        // Option B: voir tous les patients

    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_CREATE,
    PERMISSIONS.APPOINTMENTS_EDIT,

    // DONNÉES MÉDICALES - Accès complet pour les soins
    PERMISSIONS.MEDICAL_RECORDS_VIEW,
    PERMISSIONS.MEDICAL_RECORDS_CREATE,   // Créer des entrées médicales
    PERMISSIONS.MEDICAL_RECORDS_EDIT,     // Modifier les dossiers
    PERMISSIONS.MEDICAL_RECORDS_DELETE,   // Supprimer les dossiers
    PERMISSIONS.MEDICAL_NOTES_CREATE,
    PERMISSIONS.MEDICAL_ALLERGIES_VIEW,   // CRITIQUE: sécurité des soins
    PERMISSIONS.MEDICAL_VITALS_VIEW,
    PERMISSIONS.MEDICAL_VITALS_EDIT,
    PERMISSIONS.MEDICAL_PRESCRIPTIONS_VIEW,

    // Consentements
    PERMISSIONS.CONSENTS_VIEW,
    PERMISSIONS.CONSENT_TEMPLATES_VIEW,

    // Paramètres
    PERMISSIONS.SETTINGS_VIEW
  ],

  secretary: [
    // Secrétaire: Gestion administrative SANS données médicales
    PERMISSIONS.PATIENTS_VIEW,
    PERMISSIONS.PATIENTS_VIEW_ALL,
    PERMISSIONS.PATIENTS_CREATE,
    PERMISSIONS.PATIENTS_EDIT,

    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_VIEW_ALL,
    PERMISSIONS.APPOINTMENTS_CREATE,
    PERMISSIONS.APPOINTMENTS_EDIT,
    PERMISSIONS.APPOINTMENTS_DELETE,
    PERMISSIONS.APPOINTMENTS_VIEW_PRACTITIONER,

    // PAS DE DONNÉES MÉDICALES

    // Consentements - Attribution uniquement
    PERMISSIONS.CONSENTS_VIEW,
    PERMISSIONS.CONSENTS_ASSIGN,
    PERMISSIONS.CONSENT_TEMPLATES_VIEW,

    // Factures et devis
    PERMISSIONS.INVOICES_VIEW,
    PERMISSIONS.INVOICES_CREATE,
    PERMISSIONS.INVOICES_EDIT,
    PERMISSIONS.INVOICES_SEND,
    PERMISSIONS.QUOTES_VIEW,
    PERMISSIONS.QUOTES_CREATE,
    PERMISSIONS.QUOTES_EDIT,

    // Paramètres
    PERMISSIONS.SETTINGS_VIEW
  ],

  readonly: [
    // Lecture seule
    PERMISSIONS.PATIENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.MEDICAL_RECORDS_VIEW,
    PERMISSIONS.CONSENTS_VIEW,
    PERMISSIONS.INVOICES_VIEW,
    PERMISSIONS.QUOTES_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.SETTINGS_VIEW
  ]
};

/**
 * Fonction helper: Obtenir les permissions d'un rôle
 * @param {string} role - Rôle de l'utilisateur
 * @returns {string[]} - Array de permissions
 */
function getPermissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Fonction helper: Vérifier si une permission est valide
 * @param {string} permission - Permission à vérifier
 * @returns {boolean}
 */
function isValidPermission(permission) {
  return Object.values(PERMISSIONS).includes(permission);
}

/**
 * Fonction helper: Vérifier si un rôle existe
 * @param {string} role - Rôle à vérifier
 * @returns {boolean}
 */
function isValidRole(role) {
  return Object.keys(ROLE_PERMISSIONS).includes(role);
}

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  isValidPermission,
  isValidRole
};

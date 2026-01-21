/**
 * Authentication Helpers
 * Utilities for formatting user permissions and subscription data
 *
 * IMPORTANT: Hiérarchie des permissions
 * 1. D'abord les permissions du RÔLE (getPermissionsForRole)
 * 2. Ensuite les permissions PERSONNALISÉES de l'utilisateur (user.permissions)
 *
 * Format des permissions: module.action (ex: users.view, patients.create)
 */

const { getPermissionsForRole } = require('./permissionConstants');

/**
 * Mapping des actions DB vers les actions frontend
 * La DB stocke: { "users": { "read": true, "write": true } }
 * Le frontend attend: ["users.view", "users.create", "users.edit"]
 */
const ACTION_MAPPING = {
  read: 'view',
  write: 'create',
  update: 'edit',
  delete: 'delete',
  // Actions qui restent identiques
  view: 'view',
  create: 'create',
  edit: 'edit',
  export: 'export',
  manage: 'manage',
  approve: 'approve',
  revoke: 'revoke',
  assign: 'assign',
  send: 'send'
};

/**
 * Convert permissions object to array format expected by frontend
 *
 * Input format (stored in DB):
 * {
 *   "users": { "read": true, "write": true, "delete": false },
 *   "patients": { "read": true, "write": false }
 * }
 *
 * Output format (expected by frontend):
 * ["users.view", "users.create", "patients.view"]
 *
 * @param {Object} permissionsObject - Permissions object from database
 * @returns {Array<string>} Array of permission strings in module.action format
 */
function flattenPermissions(permissionsObject) {
  if (!permissionsObject || typeof permissionsObject !== 'object') {
    return [];
  }

  const permissions = [];

  // Iterate through each module (users, patients, etc.)
  for (const [module, actions] of Object.entries(permissionsObject)) {
    if (!actions || typeof actions !== 'object') {
      continue;
    }

    // Iterate through each action (read, write, delete)
    for (const [action, hasPermission] of Object.entries(actions)) {
      if (hasPermission === true) {
        // Map DB action to frontend action format
        const mappedAction = ACTION_MAPPING[action] || action;
        permissions.push(`${module}.${mappedAction}`);
      }
    }
  }

  return permissions;
}

/**
 * Get subscription data for a company
 * TEMPORARY: Returns default subscription until Subscription model is implemented
 *
 * TODO: Replace with actual database query when Subscription model exists
 *
 * @param {string} companyId - Company UUID
 * @returns {Promise<Object>} Subscription object
 */
async function getCompanySubscription(companyId) {
  // TODO: Implement actual subscription lookup
  // const subscription = await Subscription.findOne({
  //   where: { company_id: companyId, is_active: true }
  // });

  // TEMPORARY FALLBACK: Return default active subscription
  // This ensures frontend won't break while subscription system is being built
  return {
    status: 'active',
    plan: 'professional',
    features: [
      'appointments',
      'patients',
      'medical_records',
      'prescriptions',
      'invoicing',
      'quotes',
      'consents',
      'analytics',
      'multi_user',
      'email_notifications'
    ],
    planLimits: {
      maxUsers: 50,
      maxPatients: 10000,
      maxAppointmentsPerMonth: 5000,
      maxStorageGB: 100
    },
    usage: {
      users: 1,
      patients: 0,
      appointmentsThisMonth: 0,
      storageUsedGB: 0.1
    },
    isActive: true,
    isTrial: false,
    trialEndsAt: null,
    expiresAt: null, // null = no expiration (active subscription)
    billingCycle: 'monthly',
    startedAt: new Date().toISOString(),
    renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
  };
}

/**
 * Format user permissions for login/auth responses
 *
 * HIÉRARCHIE DES PERMISSIONS:
 * 1. Permissions du RÔLE (définies dans permissionConstants.js)
 * 2. Permissions PERSONNALISÉES (stockées dans user.permissions en DB)
 *
 * Les permissions personnalisées s'ajoutent aux permissions du rôle,
 * elles ne les remplacent pas.
 *
 * @param {Object} user - User model instance (must have role and optionally permissions)
 * @returns {Array<string>} Merged permissions array in module.action format
 */
function formatUserPermissions(user) {
  if (!user) {
    return [];
  }

  // 1. Obtenir les permissions du RÔLE
  const rolePermissions = getPermissionsForRole(user.role) || [];

  // 2. Obtenir les permissions PERSONNALISÉES (si existantes)
  let customPermissions = [];
  if (user.permissions) {
    // Convertir l'objet de permissions en tableau au format module.action
    customPermissions = flattenPermissions(user.permissions);
  }

  // 3. Fusionner et dédupliquer
  const allPermissions = [...new Set([...rolePermissions, ...customPermissions])];

  return allPermissions;
}

/**
 * Check if a user has a specific permission
 *
 * @param {Object} user - User model instance
 * @param {string} permission - Permission string (e.g., "users.view")
 * @returns {boolean} True if user has permission
 */
function hasPermission(user, permission) {
  if (!user) {
    return false;
  }

  const allPermissions = formatUserPermissions(user);
  return allPermissions.includes(permission);
}

/**
 * Check if subscription is active
 * TEMPORARY: Always returns true until Subscription model exists
 *
 * @param {Object} subscription - Subscription object
 * @returns {boolean} True if subscription is active
 */
function isSubscriptionActive(subscription) {
  if (!subscription) {
    return false;
  }

  // Check status
  if (subscription.status !== 'active' && subscription.status !== 'trial') {
    return false;
  }

  // Check expiration
  if (subscription.expiresAt) {
    const expirationDate = new Date(subscription.expiresAt);
    if (expirationDate < new Date()) {
      return false;
    }
  }

  return true;
}

/**
 * Format auth response data for login and /auth/me endpoints
 * Ensures consistent structure across authentication endpoints
 *
 * @param {Object} user - User model instance
 * @param {Object} company - Company model instance
 * @param {Array<string>} clinicRolePermissions - Optional permissions from clinic_roles table (takes priority)
 * @returns {Promise<Object>} Formatted auth data with user, company, subscription, permissions
 */
async function formatAuthResponse(user, company, clinicRolePermissions = null) {
  // Format user data (excluding sensitive fields)
  const userResponse = {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
    role: user.role,
    isActive: user.is_active,
    isEmailVerified: user.email_verified
  };

  // Format company data
  // Include setupStatus for onboarding flow
  const setupStatus = company.getSetupStatus ? company.getSetupStatus() : 'completed';

  const companyResponse = {
    id: company.id,
    name: company.name,
    country: company.country,
    locale: company.locale || 'fr-FR',
    email: company.email,
    phone: company.phone || '',
    // Address fields for onboarding
    addressLine1: company.address_line1 || '',
    addressLine2: company.address_line2 || '',
    city: company.city || '',
    postalCode: company.postal_code || '',
    settings: company.settings || {},
    setupStatus: setupStatus,
    setupCompletedAt: company.setup_completed_at || null
  };

  // Get subscription (temporary fallback)
  const subscription = await getCompanySubscription(company.id);

  // Format permissions:
  // PRIORITÉ 1: Permissions de clinic_roles (si fournies par le caller qui a accès à la DB clinic)
  // PRIORITÉ 2: Permissions du RÔLE hardcodées (fallback) + permissions personnalisées
  let permissions;
  if (clinicRolePermissions && Array.isArray(clinicRolePermissions) && clinicRolePermissions.length > 0) {
    // Utiliser les permissions de la table clinic_roles (source de vérité)
    // Fusionner avec les permissions personnalisées de l'utilisateur si elles existent
    let customPermissions = [];
    if (user.permissions) {
      customPermissions = flattenPermissions(user.permissions);
    }
    permissions = [...new Set([...clinicRolePermissions, ...customPermissions])];
  } else {
    // Fallback sur les permissions hardcodées
    permissions = formatUserPermissions(user);
  }

  return {
    user: userResponse,
    company: companyResponse,
    subscription: subscription,
    permissions: permissions
  };
}

module.exports = {
  flattenPermissions,
  getCompanySubscription,
  formatUserPermissions,
  hasPermission,
  isSubscriptionActive,
  formatAuthResponse
};

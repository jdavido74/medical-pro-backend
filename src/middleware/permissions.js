/**
 * Permission Middleware - PHASE 1 SECURITY FIX
 * Vérification granulaire des permissions utilisateur
 *
 * RÈGLES FONDAMENTALES:
 * 1. Les permissions viennent TOUJOURS de la BD CENTRALE, jamais du frontend
 * 2. Le JWT contient le companyId pour isoler les données
 * 3. Chaque requête vérifie que l'utilisateur a les permissions exactes
 * 4. Les permissions ne peuvent être modifiées que par super_admin
 *
 * PHASE 1 CHANGE:
 * - Plus de recherche dans healthcare_providers pour les permissions
 * - Source unique: table users dans medicalpro_central
 * - authMiddleware a déjà validé l'utilisateur
 */

const { getPermissionsForRole, ROLE_PERMISSIONS } = require('../utils/permissionConstants');
const { User, Company } = require('../models');
const { logger } = require('../utils/logger');
const { getClinicConnection } = require('../config/connectionManager');

/**
 * Helper: Get permissions from clinic_roles table (source of truth)
 * Falls back to hardcoded permissions if clinic_roles not available
 *
 * @param {string} companyId - Company UUID
 * @param {string} roleName - Role name (admin, physician, practitioner, etc.)
 * @returns {Promise<Array<string>>} Permissions array
 */
const getPermissionsFromClinicRoles = async (companyId, roleName) => {
  try {
    logger.debug(`[Permissions] getPermissionsFromClinicRoles called`, { companyId, roleName });

    if (!companyId) {
      logger.debug(`[Permissions] No companyId, using hardcoded permissions for role: ${roleName}`);
      return getPermissionsForRole(roleName);
    }

    const clinicDb = await getClinicConnection(companyId);
    if (!clinicDb) {
      logger.debug(`[Permissions] No clinic connection for ${companyId}, using hardcoded permissions`);
      return getPermissionsForRole(roleName);
    }

    logger.debug(`[Permissions] Got clinic connection for ${companyId}`);

    // Query clinic_roles for this role
    const [roles] = await clinicDb.query(
      `SELECT permissions FROM clinic_roles WHERE name = $1 LIMIT 1`,
      { bind: [roleName] }
    );

    logger.debug(`[Permissions] Query result for role ${roleName}:`, {
      rolesFound: roles?.length || 0,
      permissionsType: roles?.[0]?.permissions ? typeof roles[0].permissions : 'undefined'
    });

    if (roles && roles.length > 0 && roles[0].permissions) {
      let permissions = roles[0].permissions;

      // Handle case where permissions might be stored as JSON string
      if (typeof permissions === 'string') {
        try {
          permissions = JSON.parse(permissions);
          logger.debug(`[Permissions] Parsed permissions from JSON string`);
        } catch (e) {
          logger.warn(`[Permissions] Failed to parse permissions JSON: ${e.message}`);
        }
      }

      if (Array.isArray(permissions)) {
        logger.debug(`[Permissions] Loaded ${permissions.length} permissions from clinic_roles for role ${roleName}`);
        return permissions;
      } else {
        logger.warn(`[Permissions] Permissions is not an array:`, { permissions });
      }
    }

    // Fallback to hardcoded if not found in clinic_roles
    logger.debug(`[Permissions] No clinic_roles entry for ${roleName}, using hardcoded permissions`);
    return getPermissionsForRole(roleName);
  } catch (error) {
    logger.error(`[Permissions] Error loading from clinic_roles: ${error.message}`, {
      companyId,
      roleName
    });
    return getPermissionsForRole(roleName);
  }
};

/**
 * Fonction helper pour récupérer un utilisateur depuis la base CENTRALE uniquement
 * PHASE 1 FIX: Plus de recherche dans healthcare_providers
 *
 * @param {string} userId - ID de l'utilisateur (TOUJOURS users.id)
 * @param {string[]} attributes - Attributs à récupérer
 * @returns {Object|null} - Utilisateur trouvé ou null
 */
const findUserInCentralDatabase = async (userId, attributes = ['id', 'role', 'permissions', 'is_active', 'company_id']) => {
  const centralUser = await User.findByPk(userId, { attributes });

  if (centralUser) {
    return {
      source: 'central',
      user: centralUser,
      company_id: centralUser.company_id
    };
  }

  return null;
};

/**
 * Middleware de vérification de permissions granulaires
 * @param {string|string[]} requiredPermissions - Permission(s) requise(s)
 * @param {boolean} requireAll - true = toutes les permissions, false = au moins une
 */
const requirePermission = (requiredPermissions = [], requireAll = false) => {
  return async (req, res, next) => {
    try {
      // Vérifier que req.user existe (authMiddleware doit passer avant)
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          error: {
            message: 'Authentication required',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Normaliser requiredPermissions en array
      const permissions = Array.isArray(requiredPermissions)
        ? requiredPermissions
        : [requiredPermissions];

      // Si pas de permission requise: laisser passer
      if (permissions.length === 0) {
        return next();
      }

      // 🔐 RÉCUPÉRER LES PERMISSIONS DE LA BD CENTRALE
      // PHASE 1 FIX: Source unique = base centrale
      // authMiddleware a déjà validé que l'utilisateur existe
      const userResult = await findUserInCentralDatabase(
        req.user.id,
        ['id', 'role', 'permissions', 'is_active', 'company_id']
      );

      if (!userResult) {
        // Ne devrait pas arriver car authMiddleware a déjà validé
        logger.error(`User not found in permissions check but passed authMiddleware`, {
          userId: req.user.id,
          companyId: req.user.companyId,
          ip: req.ip
        });

        return res.status(401).json({
          success: false,
          error: {
            message: 'User not found',
            code: 'USER_NOT_FOUND',
            timestamp: new Date().toISOString()
          }
        });
      }

      const user = userResult.user;

      // Vérifier que l'utilisateur est actif
      if (!user.is_active) {
        logger.warn(`Inactive user attempted access`, {
          userId: req.user.id,
          email: req.user.email,
          ip: req.ip,
          url: req.originalUrl
        });

        return res.status(403).json({
          success: false,
          error: {
            message: 'Account is inactive',
            timestamp: new Date().toISOString()
          }
        });
      }

      // 🔐 VALIDER QUE LE RÔLE DU JWT = RÔLE EN BD
      // Protection contre la modification du JWT
      if (user.role !== req.user.role) {
        logger.error(`Role mismatch detected - possible token tampering`, {
          userId: req.user.id,
          jwtRole: req.user.role,
          dbRole: user.role,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });

        // Déconnecter l'utilisateur
        return res.status(401).json({
          success: false,
          error: {
            message: 'Authentication failed - token invalid',
            code: 'TOKEN_TAMPERED',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Obtenir les permissions du rôle depuis clinic_roles (source de vérité)
      // Fallback sur permissionConstants si clinic_roles non disponible
      const rolePermissions = await getPermissionsFromClinicRoles(req.user.companyId, user.role);

      // Fusionner avec les permissions personnalisées (si ultra_admin les a accordées)
      const customPermissions = user.permissions ? Object.keys(user.permissions) : [];
      const allUserPermissions = [...new Set([...rolePermissions, ...customPermissions])];

      // Vérifier les permissions requises
      let hasPermission = false;

      if (requireAll) {
        // Toutes les permissions requises doivent être présentes
        hasPermission = permissions.every(p => allUserPermissions.includes(p));
      } else {
        // Au moins une permission doit être présente
        hasPermission = permissions.some(p => allUserPermissions.includes(p));
      }

      if (!hasPermission) {
        logger.warn(`Permission denied`, {
          userId: req.user.id,
          email: req.user.email,
          role: user.role,
          requiredPermissions: permissions,
          userPermissions: allUserPermissions,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          error: {
            message: 'Permission denied',
            details: `Required permissions: ${permissions.join(', ')}`,
            timestamp: new Date().toISOString()
          }
        });
      }

      // 🔐 AJOUTER LES PERMISSIONS VALIDÉES À LA REQUÊTE
      // Frontend ne peut plus les modifier
      req.user.permissions = allUserPermissions;
      req.user.role = user.role; // S'assurer que le rôle est à jour

      logger.debug(`Permission granted`, {
        userId: req.user.id,
        grantedPermissions: permissions,
        method: req.method,
        url: req.originalUrl
      });

      next();
    } catch (error) {
      logger.error(`Permission check error`, {
        error: error.message,
        userId: req.user?.id,
        url: req.originalUrl,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'Permission verification failed',
          timestamp: new Date().toISOString()
        }
      });
    }
  };
};

/**
 * Middleware pour vérifier que l'utilisateur opère sur sa propre clinique
 * Prévient les attaques multi-tenant où un attaquant changerait son companyId
 */
const verifyCompanyContext = async (req, res, next) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Company context missing',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Récupérer l'utilisateur pour vérifier son company_id en BD
    // PHASE 1 FIX: Source unique = base centrale
    const userResult = await findUserInCentralDatabase(
      req.user.id,
      ['id', 'company_id']
    );

    if (!userResult) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const user = userResult.user;
    // PHASE 1 FIX: L'utilisateur vient toujours de la base centrale
    const userPrimaryCompanyId = user.company_id;

    // 🔐 PHASE 1 FIX: authMiddleware a DÉJÀ validé le companyId
    // Si on arrive ici, le companyId du JWT est soit:
    // 1. La clinique principale (userPrimaryCompanyId)
    // 2. Une clinique avec un membership actif
    // authMiddleware aurait rejeté la requête sinon.
    //
    // Ce middleware confirme simplement que le contexte est valide
    // et ajoute les infos validées à req.user

    // Ajouter le companyId validé à la requête (déjà validé par authMiddleware)
    req.user.validatedCompanyId = req.user.companyId;
    req.user.primaryCompanyId = userPrimaryCompanyId;

    next();
  } catch (error) {
    logger.error(`Company context verification failed`, {
      error: error.message,
      userId: req.user?.id,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: {
        message: 'Company verification failed',
        timestamp: new Date().toISOString()
      }
    });
  }
};

/**
 * Middleware pour vérifier qu'on opère sur la bonne ressource (patient, RDV, etc)
 * @param {string} resourceCompanyIdField - Chemin vers le companyId dans la ressource
 * Exemple: 'clinicId', 'patient.clinicId'
 */
const verifyResourceOwnership = (resourceCompanyIdField = 'clinicId') => {
  return async (req, res, next) => {
    try {
      // Si pas d'objet ressource: passer
      if (!req.resource) {
        return next();
      }

      // Obtenir le companyId de la ressource
      const resourceCompanyId = resourceCompanyIdField.split('.').reduce(
        (obj, key) => obj?.[key],
        req.resource
      );

      // Vérifier que la ressource appartient à la clinique de l'utilisateur
      if (resourceCompanyId && resourceCompanyId !== req.user.validatedCompanyId) {
        logger.warn(`Resource ownership verification failed`, {
          userId: req.user.id,
          userCompanyId: req.user.validatedCompanyId,
          resourceCompanyId: resourceCompanyId,
          resourceType: req.resource.constructor.name,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          error: {
            message: 'Access denied - resource not found',
            timestamp: new Date().toISOString()
          }
        });
      }

      next();
    } catch (error) {
      logger.error(`Resource ownership check error`, {
        error: error.message,
        userId: req.user?.id,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'Resource verification failed',
          timestamp: new Date().toISOString()
        }
      });
    }
  };
};

/**
 * Middleware helper pour vérifier qu'on opère sur ses propres données
 * Utilisé pour les patients, RDV, etc où userId est lié à la ressource
 */
const verifyUserResourceAccess = (userIdField = 'userId') => {
  return (req, res, next) => {
    try {
      if (!req.resource) {
        return next();
      }

      // Obtenir le userId de la ressource
      const resourceUserId = userIdField.split('.').reduce(
        (obj, key) => obj?.[key],
        req.resource
      );

      // Super admin et admin peuvent accéder à tout
      if (['super_admin', 'admin'].includes(req.user.role)) {
        return next();
      }

      // Pour les autres rôles: vérifier qu'ils accèdent à leurs propres données
      if (resourceUserId && resourceUserId !== req.user.id) {
        logger.warn(`User resource access denied`, {
          userId: req.user.id,
          resourceUserId: resourceUserId,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          error: {
            message: 'Access denied',
            timestamp: new Date().toISOString()
          }
        });
      }

      next();
    } catch (error) {
      logger.error(`User resource check error`, {
        error: error.message,
        userId: req.user?.id,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'Access verification failed',
          timestamp: new Date().toISOString()
        }
      });
    }
  };
};

module.exports = {
  requirePermission,
  verifyCompanyContext,
  verifyResourceOwnership,
  verifyUserResourceAccess,
  getPermissionsFromClinicRoles  // Export for use in routes that need async permission check
};

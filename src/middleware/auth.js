const { verifyAccessToken } = require('../config/jwt');
const { logger } = require('../utils/logger');
const { User, Company, UserClinicMembership } = require('../models');

/**
 * Middleware d'authentification JWT - PHASE 1 SECURITY FIX
 *
 * PRINCIPE FONDAMENTAL:
 * - Le JWT contient userId (TOUJOURS users.id de la base centrale)
 * - Le companyId du JWT est VALIDÉ contre la base centrale
 * - Pas de confiance aveugle au contenu du JWT
 *
 * SÉCURITÉ:
 * - Valide que l'utilisateur existe en base centrale
 * - Valide que le companyId du JWT correspond à l'utilisateur
 * - Détecte les tentatives de tampering JWT
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Récupérer le header Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          details: 'Missing or invalid Authorization header',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Extraire le token
    const token = authHeader.substring(7); // Enlever "Bearer "

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          details: 'No token provided',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Vérifier le token
    const decoded = verifyAccessToken(token);

    // ============================================================
    // PHASE 1 FIX: Valider l'utilisateur contre la base CENTRALE
    // ============================================================
    const centralUser = await User.findByPk(decoded.userId, {
      attributes: ['id', 'email', 'role', 'company_id', 'is_active']
    });

    if (!centralUser) {
      logger.warn(`JWT contains invalid userId - user not found in central DB`, {
        jwtUserId: decoded.userId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid token',
          details: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Vérifier que l'utilisateur est actif
    if (!centralUser.is_active) {
      logger.warn(`Inactive user attempted access`, {
        userId: centralUser.id,
        email: centralUser.email,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: {
          message: 'Account inactive',
          details: 'Your account has been deactivated',
          code: 'ACCOUNT_INACTIVE',
          timestamp: new Date().toISOString()
        }
      });
    }

    // ============================================================
    // PHASE 1 FIX: Valider le companyId contre la base centrale
    // ============================================================
    const jwtCompanyId = decoded.companyId;

    // Le companyId du JWT doit correspondre soit:
    // 1. Au company_id principal de l'utilisateur (users.company_id)
    // 2. OU à une clinique où il a un membership actif
    let isValidCompany = false;

    if (centralUser.company_id === jwtCompanyId) {
      // Cas 1: C'est sa clinique principale
      isValidCompany = true;
    } else {
      // Cas 2: Vérifier s'il a un membership actif pour cette clinique
      const membership = await UserClinicMembership.findOne({
        where: {
          email: centralUser.email,
          company_id: jwtCompanyId,
          is_active: true
        }
      });
      isValidCompany = !!membership;
    }

    if (!isValidCompany) {
      logger.error(`🚨 JWT companyId tampering detected!`, {
        userId: centralUser.id,
        email: centralUser.email,
        jwtCompanyId: jwtCompanyId,
        userCompanyId: centralUser.company_id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(403).json({
        success: false,
        error: {
          message: 'Invalid company context',
          details: 'You do not have access to this clinic',
          code: 'COMPANY_ACCESS_DENIED',
          timestamp: new Date().toISOString()
        }
      });
    }

    // ============================================================
    // PHASE 1 FIX: Valider le rôle (détection de tampering)
    // ============================================================
    if (decoded.role && decoded.role !== centralUser.role) {
      logger.error(`🚨 JWT role tampering detected!`, {
        userId: centralUser.id,
        email: centralUser.email,
        jwtRole: decoded.role,
        dbRole: centralUser.role,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid token',
          details: 'Token validation failed',
          code: 'TOKEN_TAMPERED',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Ajouter les infos utilisateur VALIDÉES à la requête
    // Ces valeurs viennent de la BD, pas du JWT
    req.user = {
      id: centralUser.id,              // TOUJOURS l'ID central (users.id)
      companyId: jwtCompanyId,         // Clinique active (validée)
      email: centralUser.email,        // Email de la BD
      role: centralUser.role,          // Rôle de la BD (pas du JWT)
      primaryCompanyId: centralUser.company_id  // Clinique principale
    };

    // Log de l'accès réussi (niveau debug seulement)
    logger.debug(`Authenticated user: ${req.user.email}`, {
      userId: req.user.id,
      companyId: req.user.companyId,
      role: req.user.role,
      method: req.method,
      url: req.originalUrl
    });

    next();
  } catch (error) {
    logger.warn(`Authentication failed: ${error.message}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl
    });

    // Gestion des erreurs JWT spécifiques
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Token expired',
          details: 'Please refresh your token or login again',
          code: 'TOKEN_EXPIRED',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid token',
          details: 'Token is malformed or invalid',
          code: 'TOKEN_INVALID',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Erreur générique
    return res.status(401).json({
      success: false,
      error: {
        message: 'Authentication failed',
        details: 'Unable to verify token',
        timestamp: new Date().toISOString()
      }
    });
  }
};

/**
 * Middleware d'autorisation par rôle
 * @param {string[]} allowedRoles - Rôles autorisés
 */
const authorize = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const userRole = req.user.role || 'admin';

    if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
      logger.warn(`Authorization failed for user ${req.user.email}`, {
        userRole,
        allowedRoles,
        url: req.originalUrl
      });

      return res.status(403).json({
        success: false,
        error: {
          message: 'Access denied',
          details: `Role '${userRole}' is not authorized for this action`,
          timestamp: new Date().toISOString()
        }
      });
    }

    next();
  };
};

/**
 * Middleware optionnel d'authentification
 * N'échoue pas si pas de token, mais ajoute les infos user si présent
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Pas d'auth, mais on continue
    }

    const token = authHeader.substring(7);
    const decoded = verifyAccessToken(token);

    req.user = {
      id: decoded.userId,
      companyId: decoded.companyId,
      email: decoded.email,
      role: decoded.role || 'admin'
    };

    next();
  } catch (error) {
    // En cas d'erreur, on continue sans user
    logger.debug(`Optional auth failed: ${error.message}`);
    next();
  }
};

module.exports = {
  authMiddleware,
  authorize,
  optionalAuth
};
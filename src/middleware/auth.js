const { verifyAccessToken } = require('../config/jwt');
const { logger } = require('../utils/logger');

/**
 * Middleware d'authentification JWT
 * Vérifie la présence et la validité du token Bearer
 */
const authMiddleware = (req, res, next) => {
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

    // Ajouter les infos utilisateur à la requête
    req.user = {
      id: decoded.userId,
      companyId: decoded.companyId,
      email: decoded.email,
      role: decoded.role || 'admin'
    };

    // Log de l'accès réussi (niveau debug seulement)
    logger.debug(`Authenticated user: ${req.user.email}`, {
      userId: req.user.id,
      companyId: req.user.companyId,
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
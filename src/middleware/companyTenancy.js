/**
 * Company Tenancy Middleware
 * Vérifie que l'utilisateur a accès à la company_id demandée
 *
 * Usage:
 * router.delete('/:id', companyTenancy, async (req, res) => {
 *   // req.company_id est automatiquement injecté et sécurisé
 * });
 */

const { logger } = require('../utils/logger');

/**
 * Middleware pour vérifier que l'utilisateur a accès à une company_id
 * Récupère la company_id du param, query, ou corps de la requête
 * Vérifie que ça correspond à la company_id de l'utilisateur (sauf super_admin)
 */
const companyTenancy = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Récupérer la company_id depuis différentes sources
    const requestedCompanyId =
      req.query.company_id ||
      req.body.company_id ||
      req.params.company_id;

    // Injecter la company_id de l'utilisateur (trustworthy source)
    req.company_id = req.user.companyId;

    // Si une company_id est explicitement demandée, la vérifier
    if (requestedCompanyId && requestedCompanyId !== req.user.companyId) {
      // Super admin peut accéder à n'importe quelle company
      if (req.user.role !== 'super_admin') {
        logger.warn(`Unauthorized company access attempt`, {
          userId: req.user.id,
          userCompanyId: req.user.companyId,
          requestedCompanyId,
          method: req.method,
          url: req.originalUrl
        });

        return res.status(403).json({
          success: false,
          error: {
            message: 'Access denied',
            details: 'You do not have access to this company',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Super admin peut override
      req.company_id = requestedCompanyId;
    }

    next();
  } catch (error) {
    logger.error('Company tenancy check failed:', error);
    return res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        timestamp: new Date().toISOString()
      }
    });
  }
};

/**
 * Middleware optionnel pour les opérations qui peuvent être cross-company
 * (par exemple, pour super_admin management)
 */
const optionalCompanyTenancy = (req, res, next) => {
  try {
    // Injecter la company_id demandée ou celle de l'utilisateur par défaut
    req.company_id =
      req.query.company_id ||
      req.body.company_id ||
      req.params.company_id ||
      req.user?.companyId;

    // Vérifier les permissions
    if (req.query.company_id && req.query.company_id !== req.user?.companyId) {
      if (req.user?.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Access denied',
            details: 'Only super admin can access other companies'
          }
        });
      }
    }

    next();
  } catch (error) {
    logger.error('Optional company tenancy check failed:', error);
    next(error);
  }
};

/**
 * Middleware pour forcer la company_id de l'utilisateur
 * Utile pour les routes qui doivent toujours utiliser la company de l'utilisateur
 * même si une autre est fournie
 */
const enforceUserCompany = (req, res, next) => {
  // Toujours utiliser la company de l'utilisateur
  req.body = req.body || {};
  req.body.company_id = req.user.companyId;
  req.query = req.query || {};
  req.query.company_id = req.user.companyId;

  next();
};

module.exports = {
  companyTenancy,
  optionalCompanyTenancy,
  enforceUserCompany
};

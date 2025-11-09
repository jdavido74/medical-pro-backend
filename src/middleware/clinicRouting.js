/**
 * Clinic Routing Middleware
 *
 * Purpose: Route each request to the correct clinic database
 * Extracts clinic_id from JWT and establishes connection to clinic-specific DB
 *
 * Flow:
 * 1. User authenticated (authMiddleware sets req.user)
 * 2. This middleware gets clinic_id from req.user.companyId
 * 3. Fetches clinic DB connection from connectionManager
 * 4. Attaches Sequelize instance to req.clinicDb
 * 5. All subsequent operations use req.clinicDb
 */

const { getClinicConnection } = require('../config/connectionManager');
const { logger } = require('../utils/logger');

/**
 * Middleware to route request to clinic database
 *
 * @async
 * @param {Express.Request} req - Express request object
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 *
 * Usage:
 * app.use(authMiddleware);
 * app.use(clinicRoutingMiddleware); // Must be AFTER auth
 * app.use('/api/v1/patients', patientRoutes); // Now has access to req.clinicDb
 */
const clinicRoutingMiddleware = async (req, res, next) => {
  try {
    // Skip routing for auth routes (they use central DB)
    if (req.path.startsWith('/auth')) {
      return next();
    }

    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Extract clinic ID from user's JWT
    // In new architecture: companyId = clinic_id
    const clinicId = req.user.companyId;

    if (!clinicId) {
      logger.error('User authenticated but no clinic_id found', {
        userId: req.user.id,
        email: req.user.email
      });

      return res.status(403).json({
        success: false,
        error: {
          message: 'No clinic assigned',
          details: 'User is not assigned to any clinic',
          timestamp: new Date().toISOString()
        }
      });
    }

    try {
      // Get clinic database connection
      const clinicDb = await getClinicConnection(clinicId);

      // Attach to request object
      req.clinicDb = clinicDb;
      req.clinicId = clinicId;

      logger.debug(`Routed to clinic ${clinicId}`, {
        userId: req.user.id,
        method: req.method,
        path: req.path
      });

      next();
    } catch (clinicError) {
      logger.error(`Failed to get clinic connection for ${clinicId}`, {
        userId: req.user.id,
        error: clinicError.message
      });

      return res.status(503).json({
        success: false,
        error: {
          message: 'Clinic database unavailable',
          details: `Cannot connect to clinic ${clinicId}`,
          timestamp: new Date().toISOString()
        }
      });
    }
  } catch (error) {
    logger.error('Clinic routing middleware error:', {
      error: error.message,
      userId: req.user?.id,
      path: req.path
    });

    return res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        details: 'An error occurred while routing to clinic database',
        timestamp: new Date().toISOString()
      }
    });
  }
};

module.exports = {
  clinicRoutingMiddleware
};

/**
 * Clinic Status Verification Middleware
 *
 * Purpose: Verify clinic is active and not deleted before processing requests
 * Returns specific error codes for frontend to handle appropriately
 *
 * Error Codes:
 * - CLINIC_DELETED: Clinic has been deleted (deleted_at IS NOT NULL)
 * - CLINIC_SUSPENDED: Clinic has been suspended (is_active = false)
 * - CLINIC_NOT_FOUND: Clinic doesn't exist
 */

const { getCentralConnection } = require('../config/connectionManager');
const { logger } = require('../utils/logger');

/**
 * Check clinic status in central database
 *
 * @param {string} clinicId - UUID of the clinic
 * @returns {Promise<Object>} - Clinic status information
 */
async function checkClinicStatus(clinicId) {
  try {
    const { initializeCentralConnection } = require('../config/connectionManager');
    const central = await initializeCentralConnection();

    const results = await central.query(
      `SELECT id, name, is_active, deleted_at
       FROM companies
       WHERE id = :clinicId`,
      {
        replacements: { clinicId },
        type: require('sequelize').QueryTypes.SELECT
      }
    );

    if (!results || results.length === 0) {
      return {
        exists: false,
        active: false,
        deleted: false,
        code: 'CLINIC_NOT_FOUND',
        message: 'Clinic not found'
      };
    }

    const clinic = results[0];

    // Check if deleted
    if (clinic.deleted_at !== null) {
      return {
        exists: true,
        active: false,
        deleted: true,
        code: 'CLINIC_DELETED',
        message: 'Clinic has been deleted',
        deletedAt: clinic.deleted_at
      };
    }

    // Check if suspended
    if (!clinic.is_active) {
      return {
        exists: true,
        active: false,
        deleted: false,
        code: 'CLINIC_SUSPENDED',
        message: 'Clinic has been suspended'
      };
    }

    // Clinic is active and not deleted
    return {
      exists: true,
      active: true,
      deleted: false,
      code: 'CLINIC_ACTIVE',
      message: 'Clinic is active',
      name: clinic.name
    };

  } catch (error) {
    logger.error('Error checking clinic status:', {
      clinicId,
      error: error.message,
      stack: error.stack,
      sql: error.sql
    });
    throw error;
  }
}

/**
 * Middleware to verify clinic status before processing request
 * Must be used AFTER authMiddleware and BEFORE clinicRoutingMiddleware
 *
 * @async
 * @param {Express.Request} req - Express request object
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const clinicStatusMiddleware = async (req, res, next) => {
  try {
    // Skip for auth routes
    if (req.path.startsWith('/auth') || req.path.startsWith('/health')) {
      return next();
    }

    // Check if user is authenticated
    if (!req.user) {
      return next(); // Let auth middleware handle this
    }

    const clinicId = req.user.companyId;

    if (!clinicId) {
      return next(); // Let clinic routing middleware handle this
    }

    // Check clinic status
    const status = await checkClinicStatus(clinicId);

    // If clinic is not active or deleted, return appropriate error
    if (!status.active) {
      logger.warn('Access denied for inactive clinic', {
        clinicId,
        userId: req.user.id,
        statusCode: status.code,
        path: req.path
      });

      return res.status(403).json({
        success: false,
        error: {
          code: status.code,
          message: status.message,
          details: status.deleted ? 'This clinic account has been permanently deleted' : 'This clinic account is currently suspended',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Clinic is active, continue to next middleware
    req.clinicStatus = status;
    next();

  } catch (error) {
    logger.error('Clinic status middleware error:', {
      error: error.message,
      stack: error.stack,
      sql: error.sql,
      userId: req.user?.id,
      clinicId: req.user?.companyId,
      path: req.path
    });

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        timestamp: new Date().toISOString()
      }
    });
  }
};

module.exports = {
  clinicStatusMiddleware,
  checkClinicStatus
};

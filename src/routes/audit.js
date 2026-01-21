/**
 * Audit Routes
 * 🔐 CRITIQUE: Réception et stockage des logs d'audit
 *
 * Endpoints:
 * - POST /api/v1/audit/log - Recevoir un événement d'audit du frontend
 * - GET /api/v1/audit/logs - Récupérer les logs d'audit (admin only)
 * - GET /api/v1/audit/logs/:resourceId - Logs pour une ressource spécifique
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { verifyCompanyContext, requirePermission } = require('../middleware/permissions');
const { PERMISSIONS } = require('../utils/permissionConstants');
const auditService = require('../services/auditService');
const { logger } = require('../utils/logger');
const { validateBody, validateQuery, validateParams, schemas } = require('../utils/validationSchemas');

const router = express.Router();

/**
 * @route POST /api/v1/audit/log
 * @desc Recevoir un événement d'audit du frontend et le stocker
 * @desc Source: Frontend auditLogService
 * @access Private (requires valid JWT)
 */
router.post('/log', authMiddleware, verifyCompanyContext, validateBody(schemas.auditLog), async (req, res) => {
  try {
    const { eventType, resourceType, resourceId, action, details = {} } = req.body;

    // 🔐 ENREGISTRER L'ÉVÉNEMENT EN BD
    // Ne JAMAIS faire confiance aux données du client pour les logs
    const auditLog = {
      userId: req.user.id,
      companyId: req.user.companyId,
      eventType: eventType,
      resourceType: resourceType || null,
      resourceId: resourceId || null,
      action: action,
      changes: details.changes ? JSON.stringify(details.changes) : null,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      success: true,
      errorMessage: null
    };

    // Enregistrer dans audit_logs
    await auditService.logAudit(auditLog);

    res.json({
      success: true,
      message: 'Audit event logged successfully',
      data: { eventId: auditLog.id }
    });
  } catch (error) {
    logger.error('[audit] POST /log error', {
      error: error.message,
      userId: req.user?.id,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: { message: 'Failed to log audit event' }
    });
  }
});

/**
 * @route GET /api/v1/audit/logs
 * @desc Récupérer les logs d'audit (admin/super_admin only)
 * @access Private - Admin only
 */
router.get(
  '/logs',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  validateQuery(schemas.auditLogsQuery),
  async (req, res) => {
    try {
      const { eventType, resourceType, startDate, endDate, limit, offset } = req.query;

      const filters = {
        eventType: eventType || null,
        resourceType: resourceType || null,
        startDate: startDate || null,
        endDate: endDate || null,
        limit,
        offset
      };

      const logs = await auditService.getAuditLogs(req.user.companyId, filters);

      res.json({
        success: true,
        data: {
          logs,
          total: logs.length,
          limit: filters.limit,
          offset: filters.offset
        }
      });
    } catch (error) {
      logger.error('[audit] GET /logs error', {
        error: error.message,
        userId: req.user?.id,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        error: { message: 'Failed to retrieve audit logs' }
      });
    }
  }
);

/**
 * @route GET /api/v1/audit/logs/:resourceId
 * @desc Récupérer les logs d'audit pour une ressource spécifique
 * @access Private - Admin only
 */
router.get(
  '/logs/:resourceId',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  validateParams(schemas.resourceIdParam),
  validateQuery(schemas.pagination),
  async (req, res) => {
    try {
      const { resourceId } = req.params;
      const { limit = 50, offset = 0 } = req.query;

      const filters = {
        resourceId,
        limit: Math.min(limit, 1000),
        offset
      };

      const logs = await auditService.getAuditLogs(req.user.companyId, filters);

      res.json({
        success: true,
        data: {
          logs,
          resourceId,
          total: logs.length,
          limit: filters.limit,
          offset: filters.offset
        }
      });
    } catch (error) {
      logger.error('[audit] GET /logs/:resourceId error', {
        error: error.message,
        resourceId: req.params.resourceId,
        userId: req.user?.id,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        error: { message: 'Failed to retrieve audit logs' }
      });
    }
  }
);

/**
 * @route GET /api/v1/audit/export
 * @desc Exporter les logs d'audit en CSV (admin/super_admin only)
 * @access Private - Admin only
 */
router.get(
  '/export',
  authMiddleware,
  verifyCompanyContext,
  requirePermission(PERMISSIONS.AUDIT_EXPORT),
  validateQuery(schemas.auditExportQuery),
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const filters = { startDate: startDate || null, endDate: endDate || null, limit: 50000 };

      // 🔐 LOG l'export
      await auditService.logAudit({
        userId: req.user.id,
        companyId: req.user.companyId,
        eventType: 'AUDIT_LOGS_EXPORTED',
        action: 'Exported audit logs',
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        success: true
      });

      const csv = await auditService.exportAuditLogs(req.user.companyId, filters);

      // Retourner en CSV
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.csv"');
      res.send(csv);
    } catch (error) {
      logger.error('[audit] GET /export error', {
        error: error.message,
        userId: req.user?.id,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        error: { message: 'Failed to export audit logs' }
      });
    }
  }
);

module.exports = router;

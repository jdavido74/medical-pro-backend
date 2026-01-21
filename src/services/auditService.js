/**
 * Audit Service
 * Logging sécurisé de TOUTES les actions sensibles
 *
 * IMPORTANT: Les logs d'audit sont IMMUABLES
 * Stockés en BD, jamais en localStorage
 * Ne peuvent être supprimés que par super_admin
 */

const { sequelize } = require('../config/database');
const { logger } = require('../utils/logger');

/**
 * Événements d'audit sensibles
 */
const AUDIT_EVENTS = {
  // Authentification
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  TOKEN_REFRESH: 'TOKEN_REFRESH',

  // Utilisateurs
  USER_CREATED: 'USER_CREATED',
  USER_MODIFIED: 'USER_MODIFIED',
  USER_DELETED: 'USER_DELETED',
  USER_PERMISSIONS_CHANGED: 'USER_PERMISSIONS_CHANGED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',

  // Patients
  PATIENT_CREATED: 'PATIENT_CREATED',
  PATIENT_MODIFIED: 'PATIENT_MODIFIED',
  PATIENT_DELETED: 'PATIENT_DELETED',
  PATIENT_EXPORTED: 'PATIENT_EXPORTED',
  PATIENT_DATA_ACCESSED: 'PATIENT_DATA_ACCESSED',

  // Rendez-vous
  APPOINTMENT_CREATED: 'APPOINTMENT_CREATED',
  APPOINTMENT_MODIFIED: 'APPOINTMENT_MODIFIED',
  APPOINTMENT_DELETED: 'APPOINTMENT_DELETED',
  APPOINTMENT_CONFIRMED: 'APPOINTMENT_CONFIRMED',

  // Dossiers médicaux
  MEDICAL_RECORD_ACCESSED: 'MEDICAL_RECORD_ACCESSED',
  MEDICAL_RECORD_MODIFIED: 'MEDICAL_RECORD_MODIFIED',
  MEDICAL_NOTE_CREATED: 'MEDICAL_NOTE_CREATED',

  // Factures
  INVOICE_CREATED: 'INVOICE_CREATED',
  INVOICE_MODIFIED: 'INVOICE_MODIFIED',
  INVOICE_DELETED: 'INVOICE_DELETED',
  INVOICE_SENT: 'INVOICE_SENT',

  // Consentements
  CONSENT_SIGNED: 'CONSENT_SIGNED',
  CONSENT_REVOKED: 'CONSENT_REVOKED',

  // Sécurité
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TOKEN_TAMPER_DETECTED: 'TOKEN_TAMPER_DETECTED',
  COMPANY_MISMATCH_DETECTED: 'COMPANY_MISMATCH_DETECTED',
  UNAUTHORIZED_ACCESS_ATTEMPT: 'UNAUTHORIZED_ACCESS_ATTEMPT',

  // Administration
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  AUDIT_LOGS_VIEWED: 'AUDIT_LOGS_VIEWED',
  AUDIT_LOGS_EXPORTED: 'AUDIT_LOGS_EXPORTED',
  AUDIT_LOGS_DELETED: 'AUDIT_LOGS_DELETED'
};

/**
 * Créer une entrée d'audit
 * @param {Object} options
 *   - userId: UUID de l'utilisateur
 *   - companyId: UUID de la clinique
 *   - eventType: Type d'événement (AUDIT_EVENTS)
 *   - resourceType: Type de ressource affectée (Patient, User, Appointment, etc)
 *   - resourceId: ID de la ressource
 *   - action: Brève description de l'action
 *   - changes: Objets avant/après pour les modifications
 *   - ip: IP de l'utilisateur
 *   - userAgent: User-Agent de l'utilisateur
 *   - success: boolean - L'action a-t-elle réussi?
 *   - errorMessage: Message d'erreur si applicable
 */
async function logAudit({
  userId,
  companyId,
  eventType,
  resourceType,
  resourceId,
  action,
  changes = null,
  ip,
  userAgent,
  success = true,
  errorMessage = null
}) {
  try {
    // Validation
    if (!userId || !companyId || !eventType || !action) {
      logger.error('Invalid audit log parameters', {
        userId,
        companyId,
        eventType,
        action
      });
      return;
    }

    // Créer l'entrée d'audit
    const auditLog = {
      id: require('uuid').v4(),
      user_id: userId,
      company_id: companyId,
      event_type: eventType,
      resource_type: resourceType || null,
      resource_id: resourceId || null,
      action,
      changes: changes ? JSON.stringify(changes) : null,
      ip_address: ip || null,
      user_agent: userAgent || null,
      success,
      error_message: errorMessage || null,
      timestamp: new Date(),
      created_at: new Date()
    };

    // 🔐 INSÉRER DIRECTEMENT EN BD
    // Utiliser une requête SQL directe pour garantir l'immuabilité
    await sequelize.query(
      `INSERT INTO audit_logs
        (id, user_id, company_id, event_type, resource_type, resource_id,
         action, changes, ip_address, user_agent, success, error_message,
         timestamp, created_at)
       VALUES
        (:id, :user_id, :company_id, :event_type, :resource_type, :resource_id,
         :action, :changes, :ip_address, :user_agent, :success, :error_message,
         :timestamp, :created_at)`,
      {
        replacements: auditLog,
        type: sequelize.QueryTypes.INSERT
      }
    );

    // Log aussi en Winston pour les opérations (level dépend du type)
    const logLevel = success ? 'info' : 'warn';
    logger[logLevel](`[AUDIT] ${eventType}`, {
      userId,
      companyId,
      resourceType,
      resourceId,
      action,
      success,
      ip
    });
  } catch (error) {
    // Erreur lors de l'audit logging: logger mais ne pas bloquer l'opération
    logger.error('Failed to log audit event', {
      error: error.message,
      userId,
      companyId,
      eventType,
      stack: error.stack
    });
  }
}

/**
 * Logger un événement de connexion
 */
async function logLogin(userId, companyId, ip, userAgent, success = true) {
  return logAudit({
    userId,
    companyId,
    eventType: success ? AUDIT_EVENTS.LOGIN : AUDIT_EVENTS.LOGIN_FAILED,
    action: success ? 'User login successful' : 'User login failed',
    ip,
    userAgent,
    success
  });
}

/**
 * Logger une création de ressource
 */
async function logResourceCreated(
  userId,
  companyId,
  resourceType,
  resourceId,
  resourceData,
  ip,
  userAgent
) {
  return logAudit({
    userId,
    companyId,
    eventType: `${resourceType.toUpperCase()}_CREATED`,
    resourceType,
    resourceId,
    action: `Created new ${resourceType}`,
    changes: {
      before: null,
      after: resourceData
    },
    ip,
    userAgent,
    success: true
  });
}

/**
 * Logger une modification de ressource
 */
async function logResourceModified(
  userId,
  companyId,
  resourceType,
  resourceId,
  before,
  after,
  ip,
  userAgent
) {
  // Ne logger que si des changements réels
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return;
  }

  return logAudit({
    userId,
    companyId,
    eventType: `${resourceType.toUpperCase()}_MODIFIED`,
    resourceType,
    resourceId,
    action: `Modified ${resourceType}`,
    changes: {
      before,
      after
    },
    ip,
    userAgent,
    success: true
  });
}

/**
 * Logger une suppression de ressource
 */
async function logResourceDeleted(
  userId,
  companyId,
  resourceType,
  resourceId,
  resourceData,
  ip,
  userAgent
) {
  return logAudit({
    userId,
    companyId,
    eventType: `${resourceType.toUpperCase()}_DELETED`,
    resourceType,
    resourceId,
    action: `Deleted ${resourceType}`,
    changes: {
      before: resourceData,
      after: null
    },
    ip,
    userAgent,
    success: true
  });
}

/**
 * Logger une modification de permissions
 */
async function logPermissionChanged(
  userId,
  targetUserId,
  companyId,
  before,
  after,
  ip,
  userAgent
) {
  return logAudit({
    userId,
    companyId,
    eventType: AUDIT_EVENTS.USER_PERMISSIONS_CHANGED,
    resourceType: 'User',
    resourceId: targetUserId,
    action: `Permissions changed for user`,
    changes: {
      before,
      after
    },
    ip,
    userAgent,
    success: true
  });
}

/**
 * Logger un accès refusé (sécurité)
 */
async function logPermissionDenied(userId, companyId, action, reason, ip, userAgent) {
  return logAudit({
    userId,
    companyId,
    eventType: AUDIT_EVENTS.PERMISSION_DENIED,
    action: `Access denied: ${action}`,
    changes: {
      reason
    },
    ip,
    userAgent,
    success: false
  });
}

/**
 * Logger une tentative de tamper du token
 */
async function logTokenTamper(userId, companyId, tamperedField, ip, userAgent) {
  return logAudit({
    userId,
    companyId,
    eventType: AUDIT_EVENTS.TOKEN_TAMPER_DETECTED,
    action: `Token tampering detected: ${tamperedField}`,
    ip,
    userAgent,
    success: false,
    errorMessage: `Possible token manipulation in field: ${tamperedField}`
  });
}

/**
 * Logger un accès non autorisé (breach attempt)
 */
async function logUnauthorizedAccess(
  attemptedUserId,
  companyId,
  resourceType,
  resourceId,
  ip,
  userAgent,
  reason
) {
  return logAudit({
    userId: attemptedUserId,
    companyId,
    eventType: AUDIT_EVENTS.UNAUTHORIZED_ACCESS_ATTEMPT,
    resourceType,
    resourceId,
    action: `Unauthorized access attempt: ${reason}`,
    ip,
    userAgent,
    success: false,
    errorMessage: reason
  });
}

/**
 * Récupérer les logs d'audit
 * Seulement pour les admins/super_admin
 * Seulement pour leur propre clinique
 */
async function getAuditLogs(companyId, filters = {}) {
  try {
    const {
      eventType = null,
      userId = null,
      resourceType = null,
      startDate = null,
      endDate = null,
      limit = 100,
      offset = 0
    } = filters;

    let query = `
      SELECT * FROM audit_logs
      WHERE company_id = :companyId
    `;

    const replacements = { companyId };

    if (eventType) {
      query += ` AND event_type = :eventType`;
      replacements.eventType = eventType;
    }

    if (userId) {
      query += ` AND user_id = :userId`;
      replacements.userId = userId;
    }

    if (resourceType) {
      query += ` AND resource_type = :resourceType`;
      replacements.resourceType = resourceType;
    }

    if (startDate) {
      query += ` AND timestamp >= :startDate`;
      replacements.startDate = startDate;
    }

    if (endDate) {
      query += ` AND timestamp <= :endDate`;
      replacements.endDate = endDate;
    }

    query += ` ORDER BY timestamp DESC LIMIT :limit OFFSET :offset`;
    replacements.limit = limit;
    replacements.offset = offset;

    const logs = await sequelize.query(query, {
      replacements,
      type: sequelize.QueryTypes.SELECT
    });

    return logs;
  } catch (error) {
    logger.error('Failed to retrieve audit logs', {
      error: error.message,
      companyId,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Exporter les logs d'audit (CSV)
 */
async function exportAuditLogs(companyId, filters = {}) {
  try {
    const logs = await getAuditLogs(companyId, { ...filters, limit: 10000 });

    // Convertir en CSV
    const headers = [
      'ID',
      'Event Type',
      'Action',
      'User ID',
      'Resource Type',
      'Resource ID',
      'Success',
      'IP Address',
      'Timestamp'
    ];

    const rows = logs.map(log => [
      log.id,
      log.event_type,
      log.action,
      log.user_id,
      log.resource_type || '',
      log.resource_id || '',
      log.success ? 'Yes' : 'No',
      log.ip_address || '',
      log.timestamp
    ]);

    let csv = headers.join(',') + '\n';
    csv += rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    return csv;
  } catch (error) {
    logger.error('Failed to export audit logs', {
      error: error.message,
      companyId,
      stack: error.stack
    });
    throw error;
  }
}

module.exports = {
  AUDIT_EVENTS,
  logAudit,
  logLogin,
  logResourceCreated,
  logResourceModified,
  logResourceDeleted,
  logPermissionChanged,
  logPermissionDenied,
  logTokenTamper,
  logUnauthorizedAccess,
  getAuditLogs,
  exportAuditLogs
};

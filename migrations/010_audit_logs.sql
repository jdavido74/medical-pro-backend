/**
 * Migration: Créer table d'audit logging
 * Stocke TOUTES les actions sensibles
 *
 * IMPORTANT:
 * - Table IMMUABLE (pas de UPDATE, DELETE sauf super_admin)
 * - Index sur timestamps et user_id pour les recherches rapides
 * - Indexé sur companyId pour l'isolation multi-tenant
 */

-- Créer la table audit_logs (central database)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,

  -- Qui: l'utilisateur qui a effectué l'action
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Quoi: le type d'événement et la ressource affectée
  event_type VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,

  -- Comment: description et changements
  action TEXT NOT NULL,
  changes JSONB,

  -- D'où: contexte de l'utilisateur
  ip_address INET,
  user_agent TEXT,

  -- Résultat
  success BOOLEAN DEFAULT true,
  error_message TEXT,

  -- Timestamps
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

  -- Contraintes
  CONSTRAINT audit_logs_company_fk FOREIGN KEY (company_id)
    REFERENCES companies(id) ON DELETE CASCADE
);

-- Indexes pour la performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id
  ON audit_logs(company_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
  ON audit_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp
  ON audit_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type
  ON audit_logs(event_type);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs(resource_type, resource_id);

-- Composite index pour les recherches courantes
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_timestamp
  ON audit_logs(company_id, timestamp DESC);

-- Politique de sécurité au niveau BD:
-- Personne ne peut modifier ou supprimer les logs sauf super_admin
-- À implémenter dans le code: vérifier req.user.role === 'super_admin'

-- Créer une view pour faciliter les requêtes d'audit
CREATE OR REPLACE VIEW vw_audit_logs AS
SELECT
  al.id,
  al.user_id,
  al.company_id,
  u.email as user_email,
  u.role as user_role,
  al.event_type,
  al.resource_type,
  al.resource_id,
  al.action,
  al.changes,
  al.ip_address,
  al.user_agent,
  al.success,
  al.error_message,
  al.timestamp,
  al.created_at,
  -- Durée depuis l'événement
  NOW() - al.timestamp as time_ago
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
ORDER BY al.timestamp DESC;

-- Trigger pour empêcher les modifications après création
-- (Pseudo-code, dépend du SGBD PostgreSQL)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable and cannot be modified or deleted';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_audit_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

-- Note: DELETE peut être fait mais avec contrôle au code (super_admin only)

-- Migration: clinic_025_patient_care_team.sql
-- Description: Table pour gérer les équipes de soins et le secret médical
-- Un médecin ne peut voir que les patients dont il fait partie de l'équipe de soins

-- ============================================================================
-- TABLE: patient_care_team
-- Gère l'accès des praticiens aux dossiers patients (secret médical)
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_care_team (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relations
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES healthcare_providers(id) ON DELETE CASCADE,

    -- Rôle dans l'équipe de soins
    role VARCHAR(50) NOT NULL DEFAULT 'care_team_member',
    -- Valeurs possibles:
    -- 'primary_physician' : Médecin traitant principal
    -- 'specialist' : Spécialiste
    -- 'nurse' : Infirmier/ère
    -- 'care_team_member' : Membre de l'équipe (par défaut)
    -- 'temporary_access' : Accès temporaire (remplacement, urgence)

    -- Niveau d'accès aux données
    access_level VARCHAR(20) NOT NULL DEFAULT 'full',
    -- Valeurs possibles:
    -- 'full' : Accès complet (lecture/écriture)
    -- 'read_only' : Lecture seule
    -- 'limited' : Accès limité (infos de base uniquement)
    -- 'emergency' : Accès d'urgence temporaire

    -- Audit et traçabilité
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    granted_by UUID REFERENCES healthcare_providers(id),
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_by UUID REFERENCES healthcare_providers(id),
    revocation_reason TEXT,

    -- Accès temporaire
    expires_at TIMESTAMP WITH TIME ZONE, -- NULL = permanent

    -- Notes
    notes TEXT,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Contraintes
    CONSTRAINT unique_patient_provider UNIQUE(patient_id, provider_id),
    CONSTRAINT valid_role CHECK (role IN ('primary_physician', 'specialist', 'nurse', 'care_team_member', 'temporary_access')),
    CONSTRAINT valid_access_level CHECK (access_level IN ('full', 'read_only', 'limited', 'emergency'))
);

-- Index pour les recherches fréquentes
CREATE INDEX IF NOT EXISTS idx_pct_patient_id ON patient_care_team(patient_id);
CREATE INDEX IF NOT EXISTS idx_pct_provider_id ON patient_care_team(provider_id);
CREATE INDEX IF NOT EXISTS idx_pct_provider_active ON patient_care_team(provider_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pct_patient_active ON patient_care_team(patient_id) WHERE revoked_at IS NULL;

-- Index pour les accès temporaires expirés
CREATE INDEX IF NOT EXISTS idx_pct_expires ON patient_care_team(expires_at) WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

-- ============================================================================
-- FONCTION: Mise à jour automatique de updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_patient_care_team_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_patient_care_team_updated_at ON patient_care_team;
CREATE TRIGGER trigger_update_patient_care_team_updated_at
    BEFORE UPDATE ON patient_care_team
    FOR EACH ROW
    EXECUTE FUNCTION update_patient_care_team_updated_at();

-- ============================================================================
-- VUE: Accès actifs (non révoqués, non expirés)
-- ============================================================================

CREATE OR REPLACE VIEW active_patient_care_team AS
SELECT
    pct.*,
    p.first_name AS patient_first_name,
    p.last_name AS patient_last_name,
    hp.first_name AS provider_first_name,
    hp.last_name AS provider_last_name,
    hp.specialty AS provider_specialty
FROM patient_care_team pct
JOIN patients p ON pct.patient_id = p.id
JOIN healthcare_providers hp ON pct.provider_id = hp.id
WHERE pct.revoked_at IS NULL
  AND (pct.expires_at IS NULL OR pct.expires_at > CURRENT_TIMESTAMP);

-- ============================================================================
-- COMMENTAIRES
-- ============================================================================

COMMENT ON TABLE patient_care_team IS 'Gestion des équipes de soins pour le secret médical - Un praticien ne peut accéder qu''aux patients dont il fait partie de l''équipe';
COMMENT ON COLUMN patient_care_team.role IS 'Rôle du praticien dans l''équipe de soins du patient';
COMMENT ON COLUMN patient_care_team.access_level IS 'Niveau d''accès aux données du patient';
COMMENT ON COLUMN patient_care_team.expires_at IS 'Date d''expiration pour les accès temporaires (NULL = permanent)';
COMMENT ON COLUMN patient_care_team.revoked_at IS 'Date de révocation de l''accès (NULL = actif)';

-- ============================================================================
-- DONNÉES INITIALES: Ajouter les praticiens existants aux patients existants
-- (Pour la migration des données existantes)
-- ============================================================================

-- Option 1: Ajouter automatiquement tous les praticiens à tous les patients existants
-- (À commenter si vous préférez une migration manuelle)

INSERT INTO patient_care_team (patient_id, provider_id, role, access_level, granted_by, notes)
SELECT
    p.id AS patient_id,
    hp.id AS provider_id,
    CASE
        WHEN hp.role = 'doctor' THEN 'care_team_member'
        WHEN hp.role = 'nurse' THEN 'nurse'
        ELSE 'care_team_member'
    END AS role,
    'full' AS access_level,
    hp.id AS granted_by,
    'Migration initiale - accès accordé automatiquement' AS notes
FROM patients p
CROSS JOIN healthcare_providers hp
WHERE hp.is_active = true
  AND p.archived = false
ON CONFLICT (patient_id, provider_id) DO NOTHING;

SELECT 'Migration clinic_025_patient_care_team completed successfully' AS status;

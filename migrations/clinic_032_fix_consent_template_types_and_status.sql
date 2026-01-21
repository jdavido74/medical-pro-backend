-- Migration: Fix consent template types and add status field
-- Purpose: Expand consent_type options and add template lifecycle status

-- 1. Drop and recreate consent_type CHECK constraint on consent_templates
-- First, drop the existing constraint
ALTER TABLE consent_templates DROP CONSTRAINT IF EXISTS consent_templates_consent_type_check;

-- Add new constraint with all supported types
ALTER TABLE consent_templates ADD CONSTRAINT consent_templates_consent_type_check
  CHECK (consent_type IN (
    'medical_treatment',    -- Traitement médical général
    'surgery',              -- Chirurgie
    'anesthesia',           -- Anesthésie
    'diagnostic',           -- Examens et diagnostics
    'telehealth',           -- Télémédecine
    'clinical_trial',       -- Essai clinique
    'minor_treatment',      -- Traitement de mineur
    'data_processing',      -- RGPD / Protection des données
    'photo',                -- Droit à l'image
    'communication',        -- Communication commerciale
    'dental',               -- Soins dentaires
    'mental_health',        -- Santé mentale
    'prevention',           -- Prévention / vaccinations
    'general_care'          -- Soins généraux
  ));

-- 2. Update consents table consent_type constraint as well
ALTER TABLE consents DROP CONSTRAINT IF EXISTS consents_consent_type_check;

ALTER TABLE consents ADD CONSTRAINT consents_consent_type_check
  CHECK (consent_type IN (
    'medical_treatment',
    'surgery',
    'anesthesia',
    'diagnostic',
    'telehealth',
    'clinical_trial',
    'minor_treatment',
    'data_processing',
    'photo',
    'communication',
    'dental',
    'mental_health',
    'prevention',
    'general_care'
  ));

-- 3. Add status field for template lifecycle (draft/active/inactive)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'consent_templates' AND column_name = 'status') THEN
    ALTER TABLE consent_templates ADD COLUMN status VARCHAR(20) DEFAULT 'draft';
    ALTER TABLE consent_templates ADD CONSTRAINT consent_templates_status_check
      CHECK (status IN ('draft', 'active', 'inactive'));
  END IF;
END $$;

-- 4. Add metadata JSONB for storing frontend-specific data (speciality, variables, tags)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'consent_templates' AND column_name = 'metadata') THEN
    ALTER TABLE consent_templates ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
END $$;

-- 5. Add index for status
CREATE INDEX IF NOT EXISTS idx_consent_templates_status ON consent_templates(status);

-- Update signature_method constraint on consents to include verbal and written
ALTER TABLE consents DROP CONSTRAINT IF EXISTS consents_signature_method_check;
ALTER TABLE consents ADD CONSTRAINT consents_signature_method_check
  CHECK (signature_method IN ('digital', 'checkbox', 'pin', 'verbal', 'written'));

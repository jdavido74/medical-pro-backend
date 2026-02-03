-- Migration: Remove restrictive CHECK constraint on consent_type
-- Purpose: Allow dynamic consent types from system_categories table
-- Validation now happens at the application layer using system_categories

-- 1. Drop the restrictive CHECK constraint on consent_templates
ALTER TABLE consent_templates DROP CONSTRAINT IF EXISTS consent_templates_consent_type_check;

-- 2. Drop the restrictive CHECK constraint on consents
ALTER TABLE consents DROP CONSTRAINT IF EXISTS consents_consent_type_check;

-- 3. Add a more permissive constraint (just ensures it's not empty)
-- This prevents invalid data while allowing dynamic types
ALTER TABLE consent_templates ADD CONSTRAINT consent_templates_consent_type_check
  CHECK (consent_type IS NOT NULL AND length(consent_type) >= 1 AND length(consent_type) <= 50);

ALTER TABLE consents ADD CONSTRAINT consents_consent_type_check
  CHECK (consent_type IS NOT NULL AND length(consent_type) >= 1 AND length(consent_type) <= 50);

-- Add comment to document the change
COMMENT ON COLUMN consent_templates.consent_type IS 'Consent type code - validates against system_categories table at application level';
COMMENT ON COLUMN consents.consent_type IS 'Consent type code - validates against system_categories table at application level';

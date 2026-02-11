-- clinic_056_consent_variable_substitution.sql
-- Add filled (substituted) content columns to consent_signing_requests
-- so that patients see their real data instead of [VARIABLE] placeholders

-- Practitioner who created the signing request
ALTER TABLE consent_signing_requests
  ADD COLUMN IF NOT EXISTS practitioner_id UUID REFERENCES healthcare_providers(id) ON DELETE SET NULL;

-- Filled content (variables replaced with actual patient data)
ALTER TABLE consent_signing_requests
  ADD COLUMN IF NOT EXISTS filled_title VARCHAR(255);

ALTER TABLE consent_signing_requests
  ADD COLUMN IF NOT EXISTS filled_description TEXT;

ALTER TABLE consent_signing_requests
  ADD COLUMN IF NOT EXISTS filled_terms TEXT;

-- Index for practitioner lookups
CREATE INDEX IF NOT EXISTS idx_consent_signing_requests_practitioner_id
  ON consent_signing_requests(practitioner_id);

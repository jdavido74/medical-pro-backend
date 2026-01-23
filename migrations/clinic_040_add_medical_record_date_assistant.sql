-- Migration: Add record_date and assistant_provider_id to medical_records
-- Purpose: Allow editing consultation date and associating an assistant (nurse, etc.)
-- Date: 2026-01-23

-- Add record_date column (date de consultation éditable)
-- Par défaut, utilise created_at si non spécifié
ALTER TABLE medical_records
ADD COLUMN IF NOT EXISTS record_date DATE;

-- Add assistant_provider_id column (assistant optionnel : infirmière, aide-soignant, etc.)
ALTER TABLE medical_records
ADD COLUMN IF NOT EXISTS assistant_provider_id UUID REFERENCES healthcare_providers(id) ON DELETE SET NULL;

-- Create index for assistant lookups
CREATE INDEX IF NOT EXISTS idx_medical_records_assistant ON medical_records(assistant_provider_id);

-- Create index for record_date queries
CREATE INDEX IF NOT EXISTS idx_medical_records_record_date ON medical_records(record_date DESC);

-- Initialize record_date from created_at for existing records
UPDATE medical_records
SET record_date = DATE(created_at)
WHERE record_date IS NULL;

-- Comments
COMMENT ON COLUMN medical_records.record_date IS 'Date de consultation (éditable) - Peut différer de created_at';
COMMENT ON COLUMN medical_records.assistant_provider_id IS 'Assistant ayant participé à la consultation (infirmier(e), aide-soignant(e), etc.)';

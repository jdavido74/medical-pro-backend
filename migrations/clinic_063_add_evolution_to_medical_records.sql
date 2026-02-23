-- clinic_063_add_evolution_to_medical_records.sql
-- Add evolution column to medical_records table for clinical evolution notes

ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS evolution TEXT;

COMMENT ON COLUMN medical_records.evolution IS 'Notes d''évolution clinique du patient';

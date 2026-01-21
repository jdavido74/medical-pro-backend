-- Migration 018: Add missing columns to medical_records table
-- Adds JSONB fields for frontend compatibility and RGPD compliance

-- Add symptoms array
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS symptoms JSONB DEFAULT '[]'::jsonb;

-- Add duration field
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS duration VARCHAR(100);

-- Add antecedents JSONB
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS antecedents JSONB DEFAULT '{}'::jsonb;

-- Add allergies array
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS allergies JSONB DEFAULT '[]'::jsonb;

-- Add diagnosis JSONB (structured)
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS diagnosis JSONB DEFAULT '{}'::jsonb;

-- Add chronic_conditions array
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS chronic_conditions JSONB DEFAULT '[]'::jsonb;

-- Add physical_exam JSONB
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS physical_exam JSONB DEFAULT '{}'::jsonb;

-- Add treatments array
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS treatments JSONB DEFAULT '[]'::jsonb;

-- Add blood_type
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS blood_type VARCHAR(5);

-- Add notes field
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add private_notes for doctor
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS private_notes TEXT;

-- Add access_log for RGPD compliance
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS access_log JSONB DEFAULT '[]'::jsonb;

-- Add is_signed boolean
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS is_signed BOOLEAN DEFAULT false;

-- Add is_locked boolean
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;

-- Add archived boolean
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- Add archived_at timestamp
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;

-- Add archived_by UUID
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS archived_by UUID;

-- Add created_by UUID
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS created_by UUID;

-- Add medication_warnings array
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS medication_warnings JSONB DEFAULT '[]'::jsonb;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_medical_records_archived ON medical_records(archived) WHERE archived = false;
CREATE INDEX IF NOT EXISTS idx_medical_records_is_locked ON medical_records(is_locked);

-- Add comment for RGPD compliance
COMMENT ON COLUMN medical_records.access_log IS 'Journal des accès pour conformité RGPD - Art. L1110-4 CSP';
COMMENT ON COLUMN medical_records.private_notes IS 'Notes privées visibles uniquement par le praticien créateur';

-- Update existing records with empty arrays/objects if null
UPDATE medical_records SET symptoms = '[]'::jsonb WHERE symptoms IS NULL;
UPDATE medical_records SET antecedents = '{}'::jsonb WHERE antecedents IS NULL;
UPDATE medical_records SET allergies = '[]'::jsonb WHERE allergies IS NULL;
UPDATE medical_records SET diagnosis = '{}'::jsonb WHERE diagnosis IS NULL;
UPDATE medical_records SET chronic_conditions = '[]'::jsonb WHERE chronic_conditions IS NULL;
UPDATE medical_records SET physical_exam = '{}'::jsonb WHERE physical_exam IS NULL;
UPDATE medical_records SET treatments = '[]'::jsonb WHERE treatments IS NULL;
UPDATE medical_records SET access_log = '[]'::jsonb WHERE access_log IS NULL;
UPDATE medical_records SET medication_warnings = '[]'::jsonb WHERE medication_warnings IS NULL;
UPDATE medical_records SET archived = false WHERE archived IS NULL;
UPDATE medical_records SET is_signed = false WHERE is_signed IS NULL;
UPDATE medical_records SET is_locked = false WHERE is_locked IS NULL;

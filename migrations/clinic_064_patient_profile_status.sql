-- Migration: clinic_064_patient_profile_status
-- Add profile_status column to patients table for provisional patient support
-- Allows quick patient creation with minimal data (first_name + phone only)

-- Create ENUM type if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'patient_profile_status') THEN
    CREATE TYPE patient_profile_status AS ENUM ('provisional', 'complete');
  END IF;
END$$;

-- Add column with default 'complete' (existing patients are complete)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_status patient_profile_status NOT NULL DEFAULT 'complete';

-- Backfill: mark existing polluted records as provisional
UPDATE patients SET profile_status = 'provisional'
WHERE (last_name IN ('À COMPLÉTER', 'A COMPLETAR', 'TO COMPLETE'))
  AND profile_status = 'complete';

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_patients_profile_status ON patients(profile_status);

-- Migration 019: Enhance prescriptions table with snapshots and tracking
-- Adds patient/provider snapshots, vital signs, diagnosis, additional notes, and print tracking

-- Add patient snapshot (for historical accuracy when printing)
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS patient_snapshot JSONB DEFAULT '{}'::jsonb;
COMMENT ON COLUMN prescriptions.patient_snapshot IS 'Patient data at prescription time: firstName, lastName, birthDate, gender, address, phone';

-- Add provider snapshot (for prescription header)
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS provider_snapshot JSONB DEFAULT '{}'::jsonb;
COMMENT ON COLUMN prescriptions.provider_snapshot IS 'Provider data: firstName, lastName, specialty, rpps, adeli, signature, clinic_info';

-- Add vital signs at time of visit
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS vital_signs JSONB DEFAULT '{}'::jsonb;
COMMENT ON COLUMN prescriptions.vital_signs IS 'Vital signs at visit: weight, height, bmi, bloodPressure, heartRate, temperature';

-- Add diagnosis information
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS diagnosis JSONB DEFAULT '{}'::jsonb;
COMMENT ON COLUMN prescriptions.diagnosis IS 'Diagnosis: primary, secondary[], icd10[]';

-- Add additional notes field
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS additional_notes TEXT;
COMMENT ON COLUMN prescriptions.additional_notes IS 'Additional notes from doctor (not included in main instructions)';

-- Add print tracking
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS print_count INTEGER DEFAULT 0;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS last_printed_at TIMESTAMP;

-- Add finalization fields
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS finalized_by UUID;

-- Add access log for RGPD compliance
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS access_log JSONB DEFAULT '[]'::jsonb;
COMMENT ON COLUMN prescriptions.access_log IS 'RGPD compliance - access log for traceability';

-- Update status check constraint to include 'draft', 'finalized', 'printed'
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_status_check;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_status_check
  CHECK (status IN ('draft', 'active', 'finalized', 'printed', 'dispensed', 'expired', 'cancelled'));

-- Set default values for existing records
UPDATE prescriptions SET patient_snapshot = '{}'::jsonb WHERE patient_snapshot IS NULL;
UPDATE prescriptions SET provider_snapshot = '{}'::jsonb WHERE provider_snapshot IS NULL;
UPDATE prescriptions SET vital_signs = '{}'::jsonb WHERE vital_signs IS NULL;
UPDATE prescriptions SET diagnosis = '{}'::jsonb WHERE diagnosis IS NULL;
UPDATE prescriptions SET access_log = '[]'::jsonb WHERE access_log IS NULL;
UPDATE prescriptions SET print_count = 0 WHERE print_count IS NULL;

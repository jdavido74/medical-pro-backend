-- clinic_059_prescription_clinical_context.sql
-- Add clinical context snapshot columns to prescriptions table
-- These store optional clinical data included in prescription printouts

ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS basic_info JSONB DEFAULT NULL;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS current_illness TEXT;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS antecedents JSONB DEFAULT NULL;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS physical_exam JSONB DEFAULT NULL;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS current_medications JSONB DEFAULT NULL;

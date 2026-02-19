-- Migration: clinic_062_vitals_glycemia_appointment_link
-- Purpose: Link medical records to appointments + store original treatments for sync
-- Note: blood_glucose and additional_readings are stored in vital_signs JSONB (no schema change needed)

-- Add appointment_id column to medical_records
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

-- Add original_treatments column to store snapshot of appointment treatments
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS original_treatments JSONB DEFAULT NULL;

-- Index for efficient appointment lookups
CREATE INDEX IF NOT EXISTS idx_medical_records_appointment_id ON medical_records(appointment_id);

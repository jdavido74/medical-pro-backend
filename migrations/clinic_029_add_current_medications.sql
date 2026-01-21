-- Migration: Add current_medications column to medical_records table
-- Purpose: Store patient's current medications (separate from prescribed treatments)
-- This aligns the database schema with the frontend MedicalRecordForm fields

-- Add current_medications JSONB column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'medical_records' AND column_name = 'current_medications'
    ) THEN
        ALTER TABLE medical_records ADD COLUMN current_medications JSONB DEFAULT '[]'::jsonb;
        RAISE NOTICE 'Column current_medications added to medical_records table';
    ELSE
        RAISE NOTICE 'Column current_medications already exists in medical_records table';
    END IF;
END $$;

-- Create GIN index for JSONB search on current_medications
CREATE INDEX IF NOT EXISTS idx_medical_records_current_medications_gin
    ON medical_records USING GIN (current_medications);

-- Update existing records with empty array if null
UPDATE medical_records
SET current_medications = '[]'::jsonb
WHERE current_medications IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN medical_records.current_medications IS 'Médicaments actuellement pris par le patient (distinct des traitements prescrits) - Structure: [{ medication, dosage, frequency, startDate, prescribedBy, notes }]';

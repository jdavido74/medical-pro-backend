-- Migration: Add id_number column to patients table
-- Purpose: Store patient ID document number (DNI, NIE, Passport, etc.)
-- This aligns the database schema with the frontend form fields

-- Add id_number column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patients' AND column_name = 'id_number'
    ) THEN
        ALTER TABLE patients ADD COLUMN id_number VARCHAR(50);
        RAISE NOTICE 'Column id_number added to patients table';
    ELSE
        RAISE NOTICE 'Column id_number already exists in patients table';
    END IF;
END $$;

-- Add coverage_type column if it doesn't exist (for insurance type)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patients' AND column_name = 'coverage_type'
    ) THEN
        ALTER TABLE patients ADD COLUMN coverage_type VARCHAR(50);
        RAISE NOTICE 'Column coverage_type added to patients table';
    ELSE
        RAISE NOTICE 'Column coverage_type already exists in patients table';
    END IF;
END $$;

-- Create index on id_number for faster lookups
CREATE INDEX IF NOT EXISTS idx_patients_id_number ON patients(id_number);

COMMENT ON COLUMN patients.id_number IS 'Patient ID document number (DNI, NIE, Passport, etc.)';
COMMENT ON COLUMN patients.coverage_type IS 'Insurance coverage type (Public, Private, Mixed)';

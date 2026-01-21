-- Migration: Make birth_date nullable in patients table
-- Purpose: Allow patient creation without birth date (only first_name, last_name, email, phone required)
-- Date: 2024-12-09

-- Remove NOT NULL constraint from birth_date
ALTER TABLE patients ALTER COLUMN birth_date DROP NOT NULL;

-- Also fix gender constraint to accept all values
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_gender_check;
ALTER TABLE patients ADD CONSTRAINT patients_gender_check CHECK (gender IN ('M', 'F', 'O', 'N/A', 'other') OR gender IS NULL);

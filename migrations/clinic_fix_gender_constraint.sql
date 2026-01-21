-- Migration: Fix Gender Constraint in Clinic Databases
-- Date: 2025-12-06
-- Purpose: Update gender check constraint to accept M, F, O, N/A values

-- Drop old constraint that only allowed M, F, other
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_gender_check;

-- Add new constraint with correct values
ALTER TABLE patients ADD CONSTRAINT patients_gender_check
  CHECK (gender IN ('M', 'F', 'O', 'N/A'));

-- Verify the change
SELECT conname, consrc
FROM pg_constraint
WHERE conname = 'patients_gender_check';

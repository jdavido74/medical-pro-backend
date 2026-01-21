-- Migration: Fix healthcare_providers role constraint
-- Purpose: Add 'doctor' and 'specialist' roles to match the application schema
-- This allows creating healthcare providers with these business roles

-- Drop existing constraint
ALTER TABLE healthcare_providers
DROP CONSTRAINT IF EXISTS healthcare_providers_role_check;

-- Add new constraint with all valid roles
-- System roles: super_admin, admin
-- Business roles: doctor, practitioner, specialist, nurse, secretary, readonly
ALTER TABLE healthcare_providers
ADD CONSTRAINT healthcare_providers_role_check
CHECK (role IN ('super_admin', 'admin', 'doctor', 'practitioner', 'specialist', 'nurse', 'secretary', 'readonly'));

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE 'Healthcare providers role constraint updated to include: super_admin, admin, doctor, practitioner, specialist, nurse, secretary, readonly';
END $$;

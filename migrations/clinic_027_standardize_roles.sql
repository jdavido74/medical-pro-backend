-- Migration: Standardize role values
-- Date: 2026-01-16
-- Description: Rationalize role values to use standardized names:
--   - 'doctor', 'specialist' -> 'physician' (médecins)
--   - 'nurse' -> 'practitioner' (autres professionnels de santé)
--   - Keep: 'admin', 'super_admin', 'secretary', 'readonly'

-- ============================================================================
-- 1. HEALTHCARE_PROVIDERS TABLE - Update role values
-- ============================================================================

-- First, update existing role values to new standardized values
UPDATE healthcare_providers SET role = 'physician' WHERE role IN ('doctor', 'specialist');
UPDATE healthcare_providers SET role = 'practitioner' WHERE role = 'nurse';

-- Drop old constraint if exists
ALTER TABLE healthcare_providers DROP CONSTRAINT IF EXISTS healthcare_providers_role_check;
ALTER TABLE healthcare_providers DROP CONSTRAINT IF EXISTS check_role;

-- Add new constraint with standardized roles
ALTER TABLE healthcare_providers ADD CONSTRAINT healthcare_providers_role_check
  CHECK (role IN ('super_admin', 'admin', 'physician', 'practitioner', 'secretary', 'readonly'));

-- ============================================================================
-- 2. CLINIC_ROLES TABLE - Update default system roles
-- ============================================================================

-- Update existing system roles
UPDATE clinic_roles SET id = 'physician', name = 'Médecin'
  WHERE id = 'doctor' AND is_system_role = true;

UPDATE clinic_roles SET id = 'practitioner', name = 'Praticien de santé'
  WHERE id = 'nurse' AND is_system_role = true;

-- Delete specialist role if it exists (merged into physician)
DELETE FROM clinic_roles WHERE id = 'specialist' AND is_system_role = true;

-- ============================================================================
-- 3. PATIENT_CARE_TEAM TABLE - Update care team roles
-- ============================================================================

-- Update care team roles (these are different context but should be consistent)
UPDATE patient_care_team SET role = 'practitioner' WHERE role IN ('nurse', 'specialist');

-- Drop old constraint if exists
ALTER TABLE patient_care_team DROP CONSTRAINT IF EXISTS patient_care_team_role_check;
ALTER TABLE patient_care_team DROP CONSTRAINT IF EXISTS check_role;

-- Add new constraint with standardized care team roles
ALTER TABLE patient_care_team ADD CONSTRAINT patient_care_team_role_check
  CHECK (role IN ('primary_physician', 'referring_physician', 'practitioner', 'care_team_member', 'temporary_access'));

-- ============================================================================
-- 4. AUDIT LOG for tracking this migration
-- ============================================================================

-- Log the migration in audit if the table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
    INSERT INTO audit_logs (id, event_type, user_id, description, created_at)
    VALUES (
      gen_random_uuid(),
      'SYSTEM_MIGRATION',
      '00000000-0000-0000-0000-000000000000',
      'Standardized role values: doctor/specialist -> physician, nurse -> practitioner',
      NOW()
    );
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK (if needed, run manually):
-- ============================================================================
-- UPDATE healthcare_providers SET role = 'doctor' WHERE role = 'physician';
-- UPDATE healthcare_providers SET role = 'nurse' WHERE role = 'practitioner';
-- ALTER TABLE healthcare_providers DROP CONSTRAINT healthcare_providers_role_check;
-- ALTER TABLE healthcare_providers ADD CONSTRAINT healthcare_providers_role_check
--   CHECK (role IN ('super_admin', 'admin', 'doctor', 'specialist', 'nurse', 'practitioner', 'secretary', 'readonly'));

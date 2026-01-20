-- Migration: clinic_035_fix_medical_records_provider_id.sql
-- Description: Allow NULL provider_id in medical_records for records created by non-healthcare providers (admins)
-- Date: 2026-01-20

-- =====================================================
-- FIX: provider_id should allow NULL for admin-created records
-- The model allows NULL but the database constraint doesn't
-- =====================================================

-- Step 1: Drop the NOT NULL constraint on provider_id
ALTER TABLE medical_records
ALTER COLUMN provider_id DROP NOT NULL;

-- Step 2: Add a comment explaining why NULL is allowed
COMMENT ON COLUMN medical_records.provider_id IS 'Healthcare provider ID. Can be NULL for records created by admin/secretary users who are not healthcare providers.';

-- Verify the change
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'medical_records' AND column_name = 'provider_id';

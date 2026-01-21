-- Migration: Phase 1 Security Fix - Unify authentication to central database
-- Purpose:
--   1. Add central_user_id column to link healthcare_providers to central users table
--   2. Make password_hash nullable (authentication moves to central database)
--   3. Add index for efficient lookups by central_user_id
--
-- SECURITY FIX:
--   Before: Users authenticated against BOTH users (central) AND healthcare_providers (clinic)
--   After:  Users ONLY authenticate against users (central database)
--   This eliminates the dual password problem and simplifies the architecture
--
-- IMPORTANT: This migration should be applied to ALL clinic databases
-- Date: 2026-01-10

-- Step 1: Add central_user_id column to link to central users table
-- This column references users.id from the central database
ALTER TABLE healthcare_providers
ADD COLUMN IF NOT EXISTS central_user_id UUID;

COMMENT ON COLUMN healthcare_providers.central_user_id IS
'Reference to users.id in the central database (medicalpro_central).
This is the authoritative user ID for authentication.
Password verification should ALWAYS use the central database.';

-- Step 2: Make password_hash nullable
-- Password is now stored ONLY in the central users table
-- This column is kept for backwards compatibility but should not be used for authentication
ALTER TABLE healthcare_providers
ALTER COLUMN password_hash DROP NOT NULL;

COMMENT ON COLUMN healthcare_providers.password_hash IS
'DEPRECATED: Do not use for authentication.
Password is now stored in central users table only.
This column is kept for backwards compatibility during migration.';

-- Step 3: Add index for efficient lookups by central_user_id
CREATE INDEX IF NOT EXISTS idx_healthcare_providers_central_user_id
ON healthcare_providers(central_user_id);

-- Step 4: Add a flag to track migration status
ALTER TABLE healthcare_providers
ADD COLUMN IF NOT EXISTS auth_migrated_to_central BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN healthcare_providers.auth_migrated_to_central IS
'Indicates if this provider''s authentication has been migrated to central database.
TRUE = password_hash is no longer valid, use central DB
FALSE = legacy mode, password_hash may still be used (for backwards compatibility)';

-- Step 5: Update existing records that have matching email in central database
-- This would be run separately with proper data to populate central_user_id
-- Note: The actual linking should be done by a migration script that queries the central DB

-- Informational query to check status after migration:
-- SELECT
--   email,
--   central_user_id,
--   auth_migrated_to_central,
--   CASE WHEN password_hash IS NULL THEN 'migrated' ELSE 'legacy' END as password_status
-- FROM healthcare_providers;

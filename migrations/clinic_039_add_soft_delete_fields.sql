-- Migration: Add soft delete fields to healthcare_providers
-- Date: 2026-01-22
-- Description: Adds deleted_at, deleted_by, and reassigned_to fields for soft delete functionality

-- Add soft delete columns to healthcare_providers
ALTER TABLE healthcare_providers
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS deleted_by UUID,
ADD COLUMN IF NOT EXISTS reassigned_to UUID;

-- Add comments for documentation
COMMENT ON COLUMN healthcare_providers.deleted_at IS 'Timestamp of soft deletion';
COMMENT ON COLUMN healthcare_providers.deleted_by IS 'ID of the user who performed the deletion';
COMMENT ON COLUMN healthcare_providers.reassigned_to IS 'ID of the provider who received reassigned patients/appointments';

-- Update account_status check constraint to include 'deleted'
-- First, drop the existing constraint if it exists
DO $$
BEGIN
    -- Try to drop the constraint (it may not exist)
    ALTER TABLE healthcare_providers DROP CONSTRAINT IF EXISTS healthcare_providers_account_status_check;
EXCEPTION
    WHEN undefined_object THEN
        -- Constraint doesn't exist, that's fine
        NULL;
END $$;

-- Add the updated constraint
ALTER TABLE healthcare_providers
ADD CONSTRAINT healthcare_providers_account_status_check
CHECK (account_status IS NULL OR account_status IN ('pending', 'active', 'suspended', 'locked', 'deleted'));

-- Create index on deleted_at for faster queries filtering out deleted providers
CREATE INDEX IF NOT EXISTS idx_healthcare_providers_deleted_at ON healthcare_providers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_healthcare_providers_account_status ON healthcare_providers(account_status);

-- Update existing findActive-type queries to exclude deleted
-- This is handled in application code, but we can create a view for convenience
CREATE OR REPLACE VIEW active_healthcare_providers AS
SELECT * FROM healthcare_providers
WHERE account_status != 'deleted' OR account_status IS NULL;

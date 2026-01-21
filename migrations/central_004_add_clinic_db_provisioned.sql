-- Migration: central_004_add_clinic_db_provisioned
-- Description: Add clinic_db_provisioned flag for deferred provisioning
-- Date: 2025-01-19

-- Add clinic_db_provisioned column
ALTER TABLE companies ADD COLUMN IF NOT EXISTS clinic_db_provisioned BOOLEAN NOT NULL DEFAULT false;

-- Add clinic_db_provisioned_at column
ALTER TABLE companies ADD COLUMN IF NOT EXISTS clinic_db_provisioned_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add comment
COMMENT ON COLUMN companies.clinic_db_provisioned IS 'Whether the clinic database has been provisioned (created + migrations run)';
COMMENT ON COLUMN companies.clinic_db_provisioned_at IS 'Timestamp when clinic database was provisioned';

-- Mark all existing companies as provisioned (they already have their clinic DBs)
UPDATE companies SET clinic_db_provisioned = true, clinic_db_provisioned_at = NOW() WHERE clinic_db_provisioned = false;

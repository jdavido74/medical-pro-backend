-- Migration: Add setup_completed_at column to companies table
-- Purpose: Track when clinic setup was completed for new admin onboarding feature
-- Date: 2026-01-14

-- Add the column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'companies' AND column_name = 'setup_completed_at'
    ) THEN
        ALTER TABLE companies ADD COLUMN setup_completed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
        COMMENT ON COLUMN companies.setup_completed_at IS 'Timestamp when clinic setup was completed - NULL means setup required for new accounts';
        RAISE NOTICE 'Column setup_completed_at added to companies table';
    ELSE
        RAISE NOTICE 'Column setup_completed_at already exists';
    END IF;
END
$$;

-- For EXISTING companies (created before this feature), mark setup as completed
-- to avoid blocking existing users
UPDATE companies
SET setup_completed_at = created_at
WHERE setup_completed_at IS NULL;

-- Verify the migration
SELECT
    id,
    name,
    created_at,
    setup_completed_at,
    CASE
        WHEN setup_completed_at IS NOT NULL THEN 'completed'
        ELSE 'not_started'
    END as setup_status
FROM companies
ORDER BY created_at DESC
LIMIT 10;

-- Migration: Add administrative_role field to healthcare_providers
-- Purpose: Allow users to have a cumulative administrative role alongside their professional role
-- Date: 2024-12-09
--
-- Architecture:
-- - role: Professional role (doctor, nurse, specialist, secretary, etc.)
-- - administrative_role: Optional administrative function (direction, clinic_admin, hr, billing)
--
-- Example: A doctor who is also the clinic director
-- → role: 'doctor', administrative_role: 'direction'

-- Add administrative_role column to healthcare_providers (for clinic databases)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'healthcare_providers'
        AND column_name = 'administrative_role'
    ) THEN
        ALTER TABLE healthcare_providers
        ADD COLUMN administrative_role VARCHAR(50) DEFAULT NULL
        CHECK (administrative_role IN ('direction', 'clinic_admin', 'hr', 'billing') OR administrative_role IS NULL);

        COMMENT ON COLUMN healthcare_providers.administrative_role IS
            'Optional administrative role that cumulates with professional role: direction, clinic_admin, hr, billing';
    END IF;
END $$;

-- Create index for querying by administrative role
CREATE INDEX IF NOT EXISTS idx_healthcare_providers_admin_role
ON healthcare_providers(administrative_role)
WHERE administrative_role IS NOT NULL;

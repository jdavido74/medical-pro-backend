-- Migration: Add logo_url to medical_facilities
-- Date: 2024-01-22
-- Description: Add logo URL field for facility branding

-- Add logo_url column if it doesn't exist
ALTER TABLE medical_facilities
ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);

-- Add comment for documentation
COMMENT ON COLUMN medical_facilities.logo_url IS 'URL to the facility logo image';

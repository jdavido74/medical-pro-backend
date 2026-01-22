-- Migration: Add facility_number to medical_facilities
-- Date: 2024-01-22
-- Description: Add alphanumeric facility number field for establishment identification

-- Add facility_number column if it doesn't exist
ALTER TABLE medical_facilities
ADD COLUMN IF NOT EXISTS facility_number VARCHAR(50);

-- Add comment for documentation
COMMENT ON COLUMN medical_facilities.facility_number IS 'Alphanumeric facility/establishment number (optional)';

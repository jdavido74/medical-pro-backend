-- Migration: Add operating_days column to clinic_settings
-- Purpose: The operating_days array tracks which days the clinic is open
-- Backend route and frontend expect this field but it was missing from DB schema

-- Add operating_days column (array of integers: 0=Sunday, 1=Monday, ..., 6=Saturday)
-- Default: weekdays (Monday=1 through Friday=5)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'clinic_settings' AND column_name = 'operating_days') THEN
    ALTER TABLE clinic_settings ADD COLUMN operating_days INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5];
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN clinic_settings.operating_days IS 'Array of day numbers when clinic is open: 0=Sunday, 1=Monday, ..., 6=Saturday';

-- Migration 011: Add availability field to healthcare_providers
-- Date: 2025-12-07
-- Purpose: Add JSONB field to store practitioner availability schedules

-- Add availability column to store weekly schedule
ALTER TABLE healthcare_providers
ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '{
  "monday": {"enabled": true, "slots": []},
  "tuesday": {"enabled": true, "slots": []},
  "wednesday": {"enabled": true, "slots": []},
  "thursday": {"enabled": true, "slots": []},
  "friday": {"enabled": true, "slots": []},
  "saturday": {"enabled": false, "slots": []},
  "sunday": {"enabled": false, "slots": []}
}'::jsonb;

-- Add color field for UI display
ALTER TABLE healthcare_providers
ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT 'blue';

-- Add comment for documentation
COMMENT ON COLUMN healthcare_providers.availability IS 'Weekly availability schedule in JSONB format. Each day contains: {enabled: boolean, slots: [{start: "HH:MM", end: "HH:MM"}]}';
COMMENT ON COLUMN healthcare_providers.color IS 'Color for calendar/UI display (blue, green, red, purple, orange, teal, etc.)';

-- Create index for faster availability queries
CREATE INDEX IF NOT EXISTS idx_healthcare_providers_active_availability
ON healthcare_providers(is_active)
WHERE is_active = true;

-- Example availability structure:
-- {
--   "monday": {
--     "enabled": true,
--     "slots": [
--       {"start": "09:00", "end": "12:00"},
--       {"start": "14:00", "end": "18:00"}
--     ]
--   },
--   "tuesday": {
--     "enabled": true,
--     "slots": [
--       {"start": "09:00", "end": "12:00"},
--       {"start": "14:00", "end": "17:00"}
--     ]
--   },
--   ...
-- }

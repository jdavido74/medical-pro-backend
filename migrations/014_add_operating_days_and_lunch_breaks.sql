-- Migration 014: Add operating_days field and update operating_hours structure for lunch breaks
-- Date: 2025-12-08
-- Purpose: Support lunch break configuration in operating hours

-- Add operating_days column to clinic_settings
ALTER TABLE clinic_settings
ADD COLUMN IF NOT EXISTS operating_days JSONB DEFAULT '[1, 2, 3, 4, 5]'::jsonb;

-- Add comment
COMMENT ON COLUMN clinic_settings.operating_days IS 'Array of operating day numbers: 0=Sunday, 1=Monday, ..., 6=Saturday';

-- Example of new operating_hours structure with lunch breaks:
-- {
--   "monday": {
--     "enabled": true,
--     "hasLunchBreak": true,
--     "morning": {"start": "08:00", "end": "12:00"},
--     "afternoon": {"start": "14:00", "end": "18:00"}
--   },
--   "tuesday": {
--     "enabled": true,
--     "hasLunchBreak": false,
--     "start": "08:00",
--     "end": "18:00"
--   }
-- }
--
-- Note: The operating_hours JSONB column can handle both structures:
-- - With lunch break: hasLunchBreak=true, morning={start,end}, afternoon={start,end}
-- - Without lunch break: hasLunchBreak=false, start, end
-- This is backward compatible as JSONB is schema-less

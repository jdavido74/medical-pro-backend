-- Migration: Change record_date from DATE to TIMESTAMP
-- Purpose: Include time in consultation date
-- Date: 2026-01-23

-- Change column type from DATE to TIMESTAMP WITH TIME ZONE
ALTER TABLE medical_records
ALTER COLUMN record_date TYPE TIMESTAMP WITH TIME ZONE
USING record_date::timestamp with time zone;

-- Update comment
COMMENT ON COLUMN medical_records.record_date IS 'Date et heure de consultation (éditable) - Peut différer de created_at';

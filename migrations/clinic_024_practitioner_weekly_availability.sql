-- Migration: Create practitioner_weekly_availability table
-- Purpose: Store practitioner-specific availability per calendar week
-- This allows practitioners to customize their availability week by week

-- Create the practitioner weekly availability table
CREATE TABLE IF NOT EXISTS practitioner_weekly_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES healthcare_providers(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    availability JSONB NOT NULL DEFAULT '{
        "monday": {"enabled": false, "slots": []},
        "tuesday": {"enabled": false, "slots": []},
        "wednesday": {"enabled": false, "slots": []},
        "thursday": {"enabled": false, "slots": []},
        "friday": {"enabled": false, "slots": []},
        "saturday": {"enabled": false, "slots": []},
        "sunday": {"enabled": false, "slots": []}
    }'::jsonb,
    source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'copied', 'template')),
    copied_from_week INTEGER,
    copied_from_year INTEGER,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,

    -- Ensure unique availability per provider/year/week combination
    CONSTRAINT unique_provider_year_week UNIQUE (provider_id, year, week_number),

    -- Validate week number (ISO weeks: 1-53)
    CONSTRAINT valid_week_number CHECK (week_number >= 1 AND week_number <= 53),

    -- Validate year (reasonable range)
    CONSTRAINT valid_year CHECK (year >= 2020 AND year <= 2100)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_pwa_provider_id ON practitioner_weekly_availability(provider_id);
CREATE INDEX IF NOT EXISTS idx_pwa_year_week ON practitioner_weekly_availability(year, week_number);
CREATE INDEX IF NOT EXISTS idx_pwa_provider_year_week ON practitioner_weekly_availability(provider_id, year, week_number);

-- Add comments for documentation
COMMENT ON TABLE practitioner_weekly_availability IS 'Stores practitioner availability overrides per calendar week';
COMMENT ON COLUMN practitioner_weekly_availability.year IS 'Calendar year (e.g., 2025)';
COMMENT ON COLUMN practitioner_weekly_availability.week_number IS 'ISO week number (1-53)';
COMMENT ON COLUMN practitioner_weekly_availability.availability IS 'JSONB structure with days and time slots';
COMMENT ON COLUMN practitioner_weekly_availability.source IS 'How this entry was created: manual, copied from another week, or from template';
COMMENT ON COLUMN practitioner_weekly_availability.copied_from_week IS 'If copied, the source week number';
COMMENT ON COLUMN practitioner_weekly_availability.copied_from_year IS 'If copied, the source year';

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_pwa_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_pwa_updated_at ON practitioner_weekly_availability;
CREATE TRIGGER trigger_pwa_updated_at
    BEFORE UPDATE ON practitioner_weekly_availability
    FOR EACH ROW
    EXECUTE FUNCTION update_pwa_updated_at();

-- Log migration completion
DO $$
BEGIN
    RAISE NOTICE 'Migration clinic_024: practitioner_weekly_availability table created successfully';
END $$;

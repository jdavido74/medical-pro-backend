-- Migration: 020_create_teams.sql
-- Description: Create teams table for organizing healthcare providers
-- Used by: Onboarding wizard and team management

-- Create teams table
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    department VARCHAR(100),
    specialties JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on name for search
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

-- Create index on department for filtering
CREATE INDEX IF NOT EXISTS idx_teams_department ON teams(department);

-- Create index on is_active for filtering
CREATE INDEX IF NOT EXISTS idx_teams_is_active ON teams(is_active);

-- Add team_id column to healthcare_providers if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'healthcare_providers' AND column_name = 'team_id'
    ) THEN
        ALTER TABLE healthcare_providers ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
        CREATE INDEX idx_healthcare_providers_team_id ON healthcare_providers(team_id);
    END IF;
END $$;

-- Comment on table
COMMENT ON TABLE teams IS 'Teams for organizing healthcare providers by department or specialty';

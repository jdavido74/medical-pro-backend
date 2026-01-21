-- Migration: Add locale column to companies table
-- Purpose: Store the full locale (fr-FR, es-ES) for proper i18n support
-- This allows storing regional preferences beyond just the country code

-- Add locale column to companies table
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'fr-FR';

-- Add country column if it doesn't exist
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS country VARCHAR(2) DEFAULT 'FR';

-- Update existing records: derive locale from country if locale is not set
UPDATE companies
SET locale = CASE
    WHEN country = 'ES' THEN 'es-ES'
    WHEN country = 'FR' THEN 'fr-FR'
    WHEN country = 'GB' THEN 'en-GB'
    ELSE 'fr-FR'
END
WHERE locale IS NULL OR locale = 'fr-FR';

-- Add constraint to ensure locale is valid
-- Only active locales for now: fr-FR, es-ES, en-GB
ALTER TABLE companies
DROP CONSTRAINT IF EXISTS companies_locale_check;

ALTER TABLE companies
ADD CONSTRAINT companies_locale_check
CHECK (locale IN ('fr-FR', 'es-ES', 'en-GB'));

-- Add constraint for country if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'companies_country_check'
        AND conrelid = 'companies'::regclass
    ) THEN
        ALTER TABLE companies
        ADD CONSTRAINT companies_country_check
        CHECK (country IN ('FR', 'ES', 'GB'));
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Constraint may already exist, ignore error
    NULL;
END $$;

-- Add index for locale for faster lookups
CREATE INDEX IF NOT EXISTS idx_companies_locale ON companies(locale);

-- Comment for documentation
COMMENT ON COLUMN companies.locale IS 'Full locale code (fr-FR, es-ES, en-GB) for i18n and regional settings';
COMMENT ON COLUMN companies.country IS 'Country code (FR, ES, GB) derived from locale';

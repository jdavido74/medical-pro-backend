-- =============================================================================
-- Migration: central_005_add_subdomain
-- Description: Add subdomain column for multi-tenant routing
-- =============================================================================

-- Add subdomain column to companies table
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS subdomain VARCHAR(50) UNIQUE;

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_companies_subdomain ON companies(subdomain)
WHERE subdomain IS NOT NULL;

-- Comment
COMMENT ON COLUMN companies.subdomain IS 'Unique subdomain for clinic access (e.g., ozondenia for ozondenia.medimaestro.com)';

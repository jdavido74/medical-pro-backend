-- Migration: Create user_clinic_memberships table
-- Purpose: Track which users belong to which clinics (multi-clinic support)
-- Location: Central database (medicalpro_central)

-- ============================================================
-- Table: user_clinic_memberships
-- ============================================================
-- This table serves as a directory to know which clinics a user belongs to.
-- The actual user credentials (password) are stored in the clinic's healthcare_providers table.
-- This enables:
--   1. Single email login that works across multiple clinics
--   2. Clinic selector when user belongs to multiple clinics
--   3. Quick lookup of user's clinics without scanning all clinic databases

CREATE TABLE IF NOT EXISTS user_clinic_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- User identification (email is the key, not foreign key to users table)
    email VARCHAR(255) NOT NULL,

    -- Which clinic this membership is for
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- The user's ID in the clinic's healthcare_providers table
    -- This allows direct lookup once clinic is selected
    provider_id UUID NOT NULL,

    -- Role in this specific clinic (for display purposes)
    role_in_clinic VARCHAR(50) NOT NULL DEFAULT 'user',

    -- If user has multiple clinics, which one is primary/default
    is_primary BOOLEAN NOT NULL DEFAULT false,

    -- Display name for clinic selector
    display_name VARCHAR(255),

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT unique_email_company UNIQUE (email, company_id),
    CONSTRAINT valid_role CHECK (role_in_clinic IN ('admin', 'doctor', 'nurse', 'secretary', 'technician', 'receptionist', 'user'))
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ucm_email ON user_clinic_memberships(email);
CREATE INDEX IF NOT EXISTS idx_ucm_company ON user_clinic_memberships(company_id);
CREATE INDEX IF NOT EXISTS idx_ucm_email_active ON user_clinic_memberships(email, is_active);

-- ============================================================
-- Trigger for updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_ucm_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ucm_updated_at ON user_clinic_memberships;
CREATE TRIGGER trigger_ucm_updated_at
    BEFORE UPDATE ON user_clinic_memberships
    FOR EACH ROW
    EXECUTE FUNCTION update_ucm_updated_at();

-- ============================================================
-- Migrate existing data
-- ============================================================
-- Insert existing healthcare_providers as memberships
-- This needs to be run per clinic database, so we'll handle it in application code

-- For the main admin users in the users table, create memberships too
INSERT INTO user_clinic_memberships (email, company_id, provider_id, role_in_clinic, is_primary, display_name, is_active)
SELECT
    u.email,
    u.company_id,
    u.id,  -- For admin users, provider_id = user.id
    u.role,
    true,  -- Admin is always primary
    CONCAT(u.first_name, ' ', u.last_name),
    u.is_active
FROM users u
WHERE u.company_id IS NOT NULL
ON CONFLICT (email, company_id) DO UPDATE SET
    role_in_clinic = EXCLUDED.role_in_clinic,
    display_name = EXCLUDED.display_name,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE user_clinic_memberships IS 'Directory of user-clinic relationships for multi-clinic authentication';
COMMENT ON COLUMN user_clinic_memberships.email IS 'User email - primary identifier for login';
COMMENT ON COLUMN user_clinic_memberships.company_id IS 'Clinic/company this membership belongs to';
COMMENT ON COLUMN user_clinic_memberships.provider_id IS 'ID in healthcare_providers table (or users table for admins)';
COMMENT ON COLUMN user_clinic_memberships.role_in_clinic IS 'User role in this specific clinic';
COMMENT ON COLUMN user_clinic_memberships.is_primary IS 'Default clinic when user has multiple memberships';

SELECT 'Migration central_003_user_clinic_memberships completed successfully' AS status;

-- Migration 012: Create clinic_roles table for custom role management
-- Date: 2025-12-07
-- Purpose: Allow facilities to create custom roles with specific permissions

-- Create clinic_roles table
CREATE TABLE IF NOT EXISTS clinic_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID REFERENCES medical_facilities(id) ON DELETE CASCADE,

    -- Role information
    name VARCHAR(100) NOT NULL,
    description TEXT,
    level INTEGER NOT NULL DEFAULT 50,  -- Priority level (higher = more privileges)
    is_system_role BOOLEAN DEFAULT false,  -- True for default roles (admin, doctor, etc.)

    -- Permissions array
    permissions JSONB DEFAULT '[]'::jsonb,  -- Array of permission strings

    -- UI customization
    color VARCHAR(20) DEFAULT 'gray',

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(facility_id, name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_clinic_roles_facility ON clinic_roles(facility_id);
CREATE INDEX IF NOT EXISTS idx_clinic_roles_system ON clinic_roles(is_system_role);

-- Create trigger for updated_at
CREATE TRIGGER update_clinic_roles_updated_at
BEFORE UPDATE ON clinic_roles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE clinic_roles IS 'Custom roles for clinic users with specific permissions';
COMMENT ON COLUMN clinic_roles.level IS 'Priority level: 100=super_admin, 90=admin, 70=doctor, 50=nurse, 30=secretary, 10=readonly';
COMMENT ON COLUMN clinic_roles.permissions IS 'Array of permission strings like ["patients.view", "patients.create", "appointments.view"]';

-- Insert default system roles for each facility
-- Note: This should be done when creating a new facility, not in this migration
-- Example structure:
-- {
--   "id": "uuid",
--   "facility_id": "facility-uuid",
--   "name": "Médecin",
--   "description": "Accès aux consultations et diagnostics",
--   "level": 70,
--   "is_system_role": true,
--   "permissions": [
--     "patients.view",
--     "patients.create",
--     "patients.edit",
--     "appointments.view",
--     "appointments.create",
--     "appointments.edit",
--     "medical_records.view",
--     "medical_records.create",
--     "medical_records.edit"
--   ],
--   "color": "green"
-- }

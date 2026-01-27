-- Migration: Create machines and machine_treatments tables
-- Purpose: Machine management for resource-based appointment scheduling

-- Create machines table
CREATE TABLE IF NOT EXISTS machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(7) DEFAULT '#3B82F6',
    location VARCHAR(200),           -- Room/area where machine is located
    company_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create machine_treatments junction table (many-to-many)
CREATE TABLE IF NOT EXISTS machine_treatments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    treatment_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(machine_id, treatment_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_machines_company_id ON machines(company_id);
CREATE INDEX IF NOT EXISTS idx_machines_is_active ON machines(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_machine_treatments_machine_id ON machine_treatments(machine_id);
CREATE INDEX IF NOT EXISTS idx_machine_treatments_treatment_id ON machine_treatments(treatment_id);

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_machines_updated_at ON machines;
CREATE TRIGGER update_machines_updated_at
    BEFORE UPDATE ON machines
    FOR EACH ROW EXECUTE FUNCTION update_products_updated_at();

-- Comments
COMMENT ON TABLE machines IS 'Physical machines/resources that can be booked for treatments';
COMMENT ON TABLE machine_treatments IS 'Junction table: which treatments can be performed on which machines';
COMMENT ON COLUMN machines.location IS 'Physical location of the machine (room, area)';

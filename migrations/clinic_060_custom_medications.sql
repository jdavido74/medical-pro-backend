-- Custom Medications table
-- Allows clinics to add their own medications alongside CIMA database results

-- Enable trigram extension if not already enabled (for name search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS custom_medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    active_ingredients JSONB DEFAULT '[]'::jsonb,
    dosage VARCHAR(200),
    pharmaceutical_form VARCHAR(200),
    administration_routes JSONB DEFAULT '[]'::jsonb,
    atc_code VARCHAR(20),
    notes TEXT,
    country VARCHAR(2) DEFAULT 'ES',
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_medications_facility ON custom_medications(facility_id);
CREATE INDEX IF NOT EXISTS idx_custom_medications_name ON custom_medications USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_custom_medications_active ON custom_medications(is_active);

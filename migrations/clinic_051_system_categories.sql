-- Migration: Create system_categories table
-- Dynamic management of system categories (consent types, appointment types, specialties, departments)
-- with multilingual support

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create system_categories table
CREATE TABLE IF NOT EXISTS system_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Unique identifier per category (e.g., 'medical_treatment', 'cardiology')
    code VARCHAR(50) NOT NULL,

    -- System category type
    -- 'consent_type', 'appointment_type', 'specialty', 'department', 'priority'
    category_type VARCHAR(50) NOT NULL,

    -- Translations (JSONB for flexibility)
    -- Structure: { "es": { "name": "...", "description": "..." }, "fr": {...}, "en": {...} }
    translations JSONB NOT NULL DEFAULT '{}',

    -- Type-specific metadata (JSONB)
    -- For consent_type: { "required": true, "renewable": false, "defaultDuration": null, "icon": "Heart", "color": "blue" }
    -- For appointment_type: { "duration": 30, "color": "blue", "priority": "normal" }
    -- For specialty: { "icon": "Heart", "color": "blue", "modules": ["base", "cardiac"] }
    -- For department: { "icon": "Building", "color": "gray" }
    metadata JSONB DEFAULT '{}',

    -- Display order
    sort_order INTEGER DEFAULT 0,

    -- Whether this category is active
    is_active BOOLEAN DEFAULT true,

    -- System categories cannot be deleted (base values)
    is_system BOOLEAN DEFAULT false,

    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Uniqueness constraint: one code per category_type
    CONSTRAINT uq_system_category_type_code UNIQUE(category_type, code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_system_categories_type ON system_categories(category_type);
CREATE INDEX IF NOT EXISTS idx_system_categories_active ON system_categories(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_system_categories_code ON system_categories(code);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_system_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_system_categories_updated_at ON system_categories;
CREATE TRIGGER trigger_system_categories_updated_at
    BEFORE UPDATE ON system_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_system_categories_updated_at();

-- Add comments for documentation
COMMENT ON TABLE system_categories IS 'Dynamic system categories with multilingual support (consent types, appointment types, specialties, departments)';
COMMENT ON COLUMN system_categories.code IS 'Unique identifier within category_type (e.g., medical_treatment, cardiology)';
COMMENT ON COLUMN system_categories.category_type IS 'Type of category: consent_type, appointment_type, specialty, department, priority';
COMMENT ON COLUMN system_categories.translations IS 'Multilingual translations: { "es": { "name": "...", "description": "..." }, ... }';
COMMENT ON COLUMN system_categories.metadata IS 'Type-specific configuration (icon, color, duration, etc.)';
COMMENT ON COLUMN system_categories.is_system IS 'System categories cannot be deleted by users';

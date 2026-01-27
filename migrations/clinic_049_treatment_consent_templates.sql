-- Migration: Create treatment_consent_templates table
-- Links treatments (services) to consent templates that should be signed

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create treatment_consent_templates table
CREATE TABLE IF NOT EXISTS treatment_consent_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Reference to the treatment (from products_services table with type='service')
    treatment_id UUID NOT NULL,

    -- Reference to the consent template
    consent_template_id UUID NOT NULL REFERENCES consent_templates(id) ON DELETE CASCADE,

    -- Whether this consent is required (vs optional) for the treatment
    is_required BOOLEAN DEFAULT true,

    -- Display order when showing consents to patient
    sort_order INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Ensure unique combinations
    CONSTRAINT uq_treatment_consent UNIQUE(treatment_id, consent_template_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_treatment_consents_treatment ON treatment_consent_templates(treatment_id);
CREATE INDEX IF NOT EXISTS idx_treatment_consents_template ON treatment_consent_templates(consent_template_id);

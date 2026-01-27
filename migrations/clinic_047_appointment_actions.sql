-- Migration: Create appointment_actions table
-- Tracks automated actions for appointments (confirmations, reminders, consent sending, etc.)

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create appointment_actions table
CREATE TABLE IF NOT EXISTS appointment_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,

    -- Type d'action
    action_type VARCHAR(50) NOT NULL,
    -- Values: 'confirmation_email', 'whatsapp_reminder', 'send_quote', 'send_consent', 'prepare_invoice'

    trigger_type VARCHAR(30) NOT NULL DEFAULT 'automatic',
    -- Values: 'automatic', 'manual', 'patient_action'

    -- Planification
    scheduled_at TIMESTAMP,
    execute_before_hours INTEGER,

    -- Statut
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    -- Values: 'pending', 'scheduled', 'in_progress', 'completed', 'failed', 'cancelled', 'validated'

    -- Validation
    requires_validation BOOLEAN DEFAULT false,
    validated_by UUID,
    validated_at TIMESTAMP,

    -- Execution
    executed_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_error TEXT,
    result_data JSONB DEFAULT '{}',

    -- Documents liés
    related_quote_id UUID,
    related_invoice_id UUID,
    related_consent_request_id UUID,

    metadata JSONB DEFAULT '{}',
    created_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_appointment_actions_appointment ON appointment_actions(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_actions_status ON appointment_actions(status);
CREATE INDEX IF NOT EXISTS idx_appointment_actions_scheduled ON appointment_actions(scheduled_at)
    WHERE status IN ('pending', 'scheduled');
CREATE INDEX IF NOT EXISTS idx_appointment_actions_type ON appointment_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_appointment_actions_requires_validation ON appointment_actions(requires_validation)
    WHERE status = 'pending' AND requires_validation = true;

-- Add constraint for valid action types
DO $$ BEGIN
    ALTER TABLE appointment_actions
    ADD CONSTRAINT chk_action_type
    CHECK (action_type IN ('confirmation_email', 'whatsapp_reminder', 'send_quote', 'send_consent', 'prepare_invoice'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add constraint for valid trigger types
DO $$ BEGIN
    ALTER TABLE appointment_actions
    ADD CONSTRAINT chk_trigger_type
    CHECK (trigger_type IN ('automatic', 'manual', 'patient_action'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add constraint for valid status values
DO $$ BEGIN
    ALTER TABLE appointment_actions
    ADD CONSTRAINT chk_action_status
    CHECK (status IN ('pending', 'scheduled', 'in_progress', 'completed', 'failed', 'cancelled', 'validated'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

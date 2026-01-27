-- Migration: Add workflow fields to appointments table
-- Adds fields for quotes, invoices, confirmation tokens, and consent status

-- Add quote reference
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS quote_id UUID;

-- Add invoice reference
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS invoice_id UUID;

-- Add created_by_provider_id for tracking who created the appointment
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS created_by_provider_id UUID;

-- Add confirmation token for patient self-confirmation
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS confirmation_token VARCHAR(64);

-- Add confirmation token expiry
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS confirmation_token_expires_at TIMESTAMP;

-- Add confirmed_at timestamp
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;

-- Add consent status tracking
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS consent_status VARCHAR(30) DEFAULT 'pending';
-- Values: 'pending', 'partial', 'sent', 'signed', 'not_required', 'missing_association'

-- Add constraint for valid consent status values
DO $$ BEGIN
    ALTER TABLE appointments
    ADD CONSTRAINT chk_consent_status
    CHECK (consent_status IN ('pending', 'partial', 'sent', 'signed', 'not_required', 'missing_association'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Index for confirmation token lookups
CREATE INDEX IF NOT EXISTS idx_appointments_confirmation_token ON appointments(confirmation_token)
    WHERE confirmation_token IS NOT NULL;

-- Index for consent status filtering
CREATE INDEX IF NOT EXISTS idx_appointments_consent_status ON appointments(consent_status);

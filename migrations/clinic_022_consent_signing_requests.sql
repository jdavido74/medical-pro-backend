-- Migration: Consent Signing Requests
-- Purpose: Store signing requests with secure tokens for digital consent signatures
-- This enables email/tablet-based consent signing workflows

-- Table for consent signing requests
CREATE TABLE IF NOT EXISTS consent_signing_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,  -- References central database companies table

    -- Related entities
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    consent_template_id UUID NOT NULL REFERENCES consent_templates(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

    -- Secure token for public access (no auth required)
    signing_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

    -- Token validity
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Request status
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'expired', 'cancelled')),

    -- Signature details
    signed_consent_id UUID REFERENCES consents(id) ON DELETE SET NULL,
    signed_at TIMESTAMP WITH TIME ZONE,

    -- How was the request sent/accessed
    sent_via VARCHAR(20) NOT NULL DEFAULT 'email' CHECK (sent_via IN ('email', 'sms', 'tablet', 'link')),

    -- Contact info for sending
    recipient_email VARCHAR(255),
    recipient_phone VARCHAR(50),

    -- Language for the consent
    language_code VARCHAR(5) DEFAULT 'fr',

    -- Custom message included in email
    custom_message TEXT,

    -- Tracking
    sent_at TIMESTAMP WITH TIME ZONE,
    viewed_at TIMESTAMP WITH TIME ZONE,
    reminder_sent_at TIMESTAMP WITH TIME ZONE,
    reminder_count INTEGER DEFAULT 0,

    -- GDPR audit trail
    ip_address_sent VARCHAR(45),
    ip_address_signed VARCHAR(45),
    device_info_signed JSONB DEFAULT '{}',

    -- Created by (healthcare provider or admin who sent the request)
    created_by UUID,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_consent_signing_requests_company ON consent_signing_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_consent_signing_requests_patient ON consent_signing_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_consent_signing_requests_token ON consent_signing_requests(signing_token);
CREATE INDEX IF NOT EXISTS idx_consent_signing_requests_status ON consent_signing_requests(status);
CREATE INDEX IF NOT EXISTS idx_consent_signing_requests_expires ON consent_signing_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_consent_signing_requests_appointment ON consent_signing_requests(appointment_id);

-- Trigger to update updated_at on changes
CREATE OR REPLACE FUNCTION update_consent_signing_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_consent_signing_requests_updated_at ON consent_signing_requests;
CREATE TRIGGER trigger_consent_signing_requests_updated_at
    BEFORE UPDATE ON consent_signing_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_consent_signing_requests_updated_at();

-- Add column to consents table to track signature image if needed
ALTER TABLE consents ADD COLUMN IF NOT EXISTS signature_image TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS signing_request_id UUID REFERENCES consent_signing_requests(id);

COMMENT ON TABLE consent_signing_requests IS 'Tracks consent signature requests sent to patients via email, SMS, or tablet link';
COMMENT ON COLUMN consent_signing_requests.signing_token IS 'Secure UUID token for public access to signing page';
COMMENT ON COLUMN consent_signing_requests.sent_via IS 'Method used to send/access the signing request';
COMMENT ON COLUMN consent_signing_requests.device_info_signed IS 'GDPR-compliant device information captured at signature time';

-- Migration: Create Consents and ConsentTemplates tables
-- Purpose: Medical consents with GDPR-compliant signatures

-- ConsentTemplate: Reusable templates
CREATE TABLE IF NOT EXISTS consent_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Identifier
  code VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,

  -- Content
  terms TEXT NOT NULL,
  version VARCHAR(20) DEFAULT '1.0',

  -- Configuration
  consent_type VARCHAR(50) NOT NULL CHECK (consent_type IN ('medical_treatment', 'data_processing', 'photo', 'communication')),
  is_mandatory BOOLEAN DEFAULT FALSE,
  auto_send BOOLEAN DEFAULT FALSE,

  -- Validity
  valid_from DATE NOT NULL,
  valid_until DATE,

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Consent: Patient signatures
CREATE TABLE IF NOT EXISTS consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
  consent_template_id UUID REFERENCES consent_templates(id) ON DELETE SET NULL,

  -- Type
  consent_type VARCHAR(50) NOT NULL CHECK (consent_type IN ('medical_treatment', 'data_processing', 'photo', 'communication')),

  -- Content
  title VARCHAR(255) NOT NULL,
  description TEXT,
  terms TEXT NOT NULL,

  -- Status
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),

  -- GDPR-Compliant Signature
  signed_at TIMESTAMP,
  signature_method VARCHAR(20) CHECK (signature_method IN ('digital', 'checkbox', 'pin')),
  ip_address INET,
  device_info JSONB DEFAULT '{}',  -- { userAgent: "...", platform: "...", timezone: "..." }

  -- Related document
  related_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique index for template code per company (allowing NULL for soft deletes)
CREATE UNIQUE INDEX idx_template_code_per_company ON consent_templates(company_id, code) WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX idx_consent_templates_company_id ON consent_templates(company_id);
CREATE INDEX idx_consent_templates_consent_type ON consent_templates(consent_type);
CREATE INDEX idx_consent_templates_deleted_at ON consent_templates(deleted_at);

CREATE INDEX idx_consents_company_id ON consents(company_id);
CREATE INDEX idx_consents_patient_id ON consents(patient_id);
CREATE INDEX idx_consents_appointment_id ON consents(appointment_id);
CREATE INDEX idx_consents_product_service_id ON consents(product_service_id);
CREATE INDEX idx_consents_status ON consents(status);
CREATE INDEX idx_consents_deleted_at ON consents(deleted_at);
CREATE INDEX idx_consents_consent_type ON consents(consent_type);
CREATE INDEX idx_consents_signed_at ON consents(signed_at);
CREATE INDEX idx_consents_patient_status ON consents(patient_id, status);

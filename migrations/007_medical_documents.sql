-- Migration: Create Documents table (Quote + Invoice combined)
-- Purpose: Single table for both quotes and invoices (FACTORIZATION!)
-- Discriminator: document_type = 'quote' | 'invoice'

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  practitioner_id UUID REFERENCES practitioners(id) ON DELETE SET NULL,

  -- Discriminator (quote vs invoice)
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('quote', 'invoice')),

  -- Numbering
  document_number VARCHAR(50) NOT NULL,

  -- Dates
  issue_date DATE NOT NULL,
  due_date DATE,

  -- Items (snapshot of AppointmentItems or manual items)
  items JSONB DEFAULT '[]',

  -- Totals
  subtotal DECIMAL(12, 2) NOT NULL,
  tax_amount DECIMAL(12, 2) NOT NULL,
  total DECIMAL(12, 2) NOT NULL,

  -- Status
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'paid', 'cancelled')),

  -- Tracking
  sent_at TIMESTAMP,
  accepted_at TIMESTAMP,

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique index for document number per company (allowing NULL for soft deletes)
CREATE UNIQUE INDEX idx_document_number_per_company ON documents(company_id, document_number) WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX idx_documents_company_id ON documents(company_id);
CREATE INDEX idx_documents_patient_id ON documents(patient_id);
CREATE INDEX idx_documents_appointment_id ON documents(appointment_id);
CREATE INDEX idx_documents_document_type ON documents(document_type);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at);
CREATE INDEX idx_documents_issue_date ON documents(issue_date);
CREATE INDEX idx_documents_number ON documents(document_number);

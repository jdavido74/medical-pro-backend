-- ============================================================================
-- Migration: clinic_055_documents_billing.sql
-- Description: Unified billing tables (documents, document_items, document_sequences)
--              + billing_settings on clinic_settings
-- ============================================================================

-- Drop old documents table if it exists (was a lightweight placeholder)
DROP TABLE IF EXISTS document_items CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS document_sequences CASCADE;

-- ============================================================================
-- 1. documents — Unified table for quotes, invoices, credit notes
-- ============================================================================
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,

    -- Identity
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('invoice', 'quote', 'credit_note')),
    document_number VARCHAR(50) NOT NULL,
    prefix VARCHAR(10),

    -- Seller snapshot (frozen at creation, EN 16931 compliant)
    seller_name VARCHAR(255) NOT NULL,
    seller_address JSONB NOT NULL DEFAULT '{}',
    seller_siren VARCHAR(14),
    seller_vat_number VARCHAR(20),
    seller_legal_form VARCHAR(100),
    seller_capital VARCHAR(50),
    seller_rcs VARCHAR(100),
    seller_email VARCHAR(255),
    seller_phone VARCHAR(20),

    -- Buyer snapshot
    buyer_name VARCHAR(255) NOT NULL,
    buyer_address JSONB DEFAULT '{}',
    buyer_siren VARCHAR(14),
    buyer_vat_number VARCHAR(20),
    buyer_email VARCHAR(255),
    buyer_phone VARCHAR(20),

    -- Dates
    issue_date DATE NOT NULL,
    due_date DATE,
    valid_until DATE,
    delivery_date DATE,

    -- Amounts
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_type VARCHAR(20) NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'percentage', 'amount')),
    discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_details JSONB NOT NULL DEFAULT '[]',
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    amount_due DECIMAL(12,2),

    -- Payment conditions
    payment_terms TEXT,
    payment_method VARCHAR(50),
    bank_details JSONB,
    late_penalty_rate DECIMAL(5,2),
    recovery_indemnity DECIMAL(10,2) DEFAULT 40,
    early_payment_discount TEXT,
    purchase_order VARCHAR(100),

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'sent', 'accepted', 'rejected', 'expired',
        'paid', 'partial', 'overdue', 'cancelled', 'converted', 'applied'
    )),

    -- Traceability timestamps
    sent_at TIMESTAMP,
    accepted_at TIMESTAMP,
    rejected_at TIMESTAMP,
    paid_at TIMESTAMP,
    converted_at TIMESTAMP,
    converted_from_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    converted_to_id UUID REFERENCES documents(id) ON DELETE SET NULL,

    -- Notes
    notes TEXT,
    terms TEXT,
    legal_mentions TEXT,

    -- E-invoicing (reform 2026)
    transaction_category VARCHAR(20),
    vat_on_debits BOOLEAN NOT NULL DEFAULT false,
    facturx_profile VARCHAR(30),
    facturx_xml TEXT,

    -- Medical extensions (optional, NULL for standalone SaaS)
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    practitioner_id UUID REFERENCES healthcare_providers(id) ON DELETE SET NULL,

    -- Metadata
    created_by UUID,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT uq_document_number UNIQUE (facility_id, document_number)
);

-- Indexes
CREATE INDEX idx_documents_facility ON documents(facility_id);
CREATE INDEX idx_documents_type ON documents(document_type);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_patient ON documents(patient_id);
CREATE INDEX idx_documents_appointment ON documents(appointment_id);
CREATE INDEX idx_documents_practitioner ON documents(practitioner_id);
CREATE INDEX idx_documents_issue_date ON documents(issue_date);
CREATE INDEX idx_documents_due_date ON documents(due_date);
CREATE INDEX idx_documents_number ON documents(document_number);
CREATE INDEX idx_documents_deleted ON documents(deleted_at);
CREATE INDEX idx_documents_converted_from ON documents(converted_from_id);
CREATE INDEX idx_documents_converted_to ON documents(converted_to_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_documents_updated_at();

-- ============================================================================
-- 2. document_items — Line items (relational, not JSONB)
-- ============================================================================
CREATE TABLE document_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,

    -- Content
    description TEXT NOT NULL,
    quantity DECIMAL(10,3) NOT NULL DEFAULT 1,
    unit VARCHAR(30) DEFAULT 'unit',
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
    tax_category_code VARCHAR(5) NOT NULL DEFAULT 'S',

    -- Computed
    line_net_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,

    -- Catalog reference (optional)
    product_service_id UUID,
    product_snapshot JSONB,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_document_items_document ON document_items(document_id);
CREATE INDEX idx_document_items_sort ON document_items(document_id, sort_order);
CREATE INDEX idx_document_items_product ON document_items(product_service_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_document_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_items_updated_at
    BEFORE UPDATE ON document_items
    FOR EACH ROW
    EXECUTE FUNCTION update_document_items_updated_at();

-- ============================================================================
-- 3. document_sequences — Sequential numbering (legal requirement)
-- ============================================================================
CREATE TABLE document_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('invoice', 'quote', 'credit_note')),
    prefix VARCHAR(10) NOT NULL,
    year INTEGER NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_document_sequence UNIQUE (facility_id, document_type, year)
);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_document_sequences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_sequences_updated_at
    BEFORE UPDATE ON document_sequences
    FOR EACH ROW
    EXECUTE FUNCTION update_document_sequences_updated_at();

-- ============================================================================
-- 4. Add billing_settings JSONB column to clinic_settings
-- ============================================================================
ALTER TABLE clinic_settings
    ADD COLUMN IF NOT EXISTS billing_settings JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN clinic_settings.billing_settings IS 'Billing configuration: seller info, prefixes, payment terms, tax rates, bank details, legal mentions';

-- ============================================================================
-- Done
-- ============================================================================

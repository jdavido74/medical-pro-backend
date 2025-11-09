-- FacturePro Initial Database Schema
-- Version: 1.0.0
-- Created: 2024-09-23

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- =====================================================
-- COMPANIES TABLE
-- =====================================================
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    country VARCHAR(2) NOT NULL CHECK (country IN ('FR', 'ES')),
    business_number VARCHAR(20),
    vat_number VARCHAR(20),
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20),
    address JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for companies
CREATE INDEX idx_companies_email ON companies(email);
CREATE INDEX idx_companies_country ON companies(country);
CREATE INDEX idx_companies_business_number ON companies(business_number) WHERE business_number IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER companies_updated_at_trigger
    BEFORE UPDATE ON companies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- USERS TABLE
-- =====================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'user', 'readonly')),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for users
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);

-- Trigger for updated_at
CREATE TRIGGER users_updated_at_trigger
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- CLIENTS TABLE
-- =====================================================
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('company', 'individual')),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    business_number VARCHAR(20),
    vat_number VARCHAR(20),
    address JSONB DEFAULT '{}',
    billing_settings JSONB DEFAULT '{}',
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for clients
CREATE INDEX idx_clients_company_id ON clients(company_id);
CREATE INDEX idx_clients_type ON clients(type);
CREATE INDEX idx_clients_is_active ON clients(is_active);
CREATE INDEX idx_clients_business_number ON clients(business_number) WHERE business_number IS NOT NULL;
CREATE INDEX idx_clients_email ON clients(email) WHERE email IS NOT NULL;

-- Unique constraint for company + name (only active clients)
CREATE UNIQUE INDEX idx_clients_company_name_unique
    ON clients(company_id, name)
    WHERE is_active = true;

-- Trigger for updated_at
CREATE TRIGGER clients_updated_at_trigger
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- INVOICES TABLE
-- =====================================================
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    number VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    issue_date DATE NOT NULL,
    due_date DATE,
    subtotal DECIMAL(10,2) NOT NULL CHECK (subtotal >= 0),
    discount_type VARCHAR(20) CHECK (discount_type IN ('percentage', 'amount', 'none')),
    discount_value DECIMAL(10,2) CHECK (discount_value >= 0),
    tax_amount DECIMAL(10,2) NOT NULL CHECK (tax_amount >= 0),
    total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR'
        CHECK (currency IN ('EUR', 'USD', 'GBP', 'CHF')),
    notes TEXT,
    payment_conditions TEXT,
    purchase_order VARCHAR(100),
    sent_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Business rules constraints
    CONSTRAINT check_due_date_after_issue_date
        CHECK (due_date IS NULL OR due_date >= issue_date),
    CONSTRAINT check_discount_percentage
        CHECK (discount_type != 'percentage' OR discount_value <= 100),
    CONSTRAINT check_discount_amount
        CHECK (discount_type != 'amount' OR discount_value <= subtotal)
);

-- Indexes for invoices
CREATE UNIQUE INDEX idx_invoices_company_number_unique ON invoices(company_id, number);
CREATE INDEX idx_invoices_company_id ON invoices(company_id);
CREATE INDEX idx_invoices_client_id ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX idx_invoices_due_date ON invoices(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_invoices_total ON invoices(total);

-- Trigger for updated_at
CREATE TRIGGER invoices_updated_at_trigger
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- QUOTES TABLE
-- =====================================================
CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    number VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'converted', 'expired')),
    quote_date DATE NOT NULL,
    valid_until DATE,
    subtotal DECIMAL(10,2) NOT NULL CHECK (subtotal >= 0),
    discount_type VARCHAR(20) CHECK (discount_type IN ('percentage', 'amount', 'none')),
    discount_value DECIMAL(10,2) CHECK (discount_value >= 0),
    tax_amount DECIMAL(10,2) NOT NULL CHECK (tax_amount >= 0),
    total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR'
        CHECK (currency IN ('EUR', 'USD', 'GBP', 'CHF')),
    notes TEXT,
    terms TEXT,
    converted_invoice_id UUID REFERENCES invoices(id),
    sent_at TIMESTAMP WITH TIME ZONE,
    accepted_at TIMESTAMP WITH TIME ZONE,
    rejected_at TIMESTAMP WITH TIME ZONE,
    converted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Business rules constraints
    CONSTRAINT check_valid_until_after_quote_date
        CHECK (valid_until IS NULL OR valid_until >= quote_date),
    CONSTRAINT check_quote_discount_percentage
        CHECK (discount_type != 'percentage' OR discount_value <= 100),
    CONSTRAINT check_quote_discount_amount
        CHECK (discount_type != 'amount' OR discount_value <= subtotal)
);

-- Indexes for quotes
CREATE UNIQUE INDEX idx_quotes_company_number_unique ON quotes(company_id, number);
CREATE INDEX idx_quotes_company_id ON quotes(company_id);
CREATE INDEX idx_quotes_client_id ON quotes(client_id);
CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_quotes_quote_date ON quotes(quote_date);
CREATE INDEX idx_quotes_valid_until ON quotes(valid_until) WHERE valid_until IS NOT NULL;
CREATE INDEX idx_quotes_total ON quotes(total);
CREATE INDEX idx_quotes_converted_invoice_id ON quotes(converted_invoice_id) WHERE converted_invoice_id IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER quotes_updated_at_trigger
    BEFORE UPDATE ON quotes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- DOCUMENT_ITEMS TABLE
-- =====================================================
CREATE TABLE document_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('invoice', 'quote')),
    description TEXT NOT NULL,
    quantity DECIMAL(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    tax_rate DECIMAL(5,2) CHECK (tax_rate >= 0 AND tax_rate <= 100),
    total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
    unit VARCHAR(20) DEFAULT 'unité',
    order_index INTEGER NOT NULL DEFAULT 0 CHECK (order_index >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for document_items
CREATE INDEX idx_document_items_document ON document_items(document_id, document_type);
CREATE INDEX idx_document_items_order ON document_items(document_id, order_index);

-- Trigger for updated_at
CREATE TRIGGER document_items_updated_at_trigger
    BEFORE UPDATE ON document_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- AUDIT TABLE (pour traçabilité future)
-- =====================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for audit_logs
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_company_id ON audit_logs(company_id);
CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- =====================================================
-- SAMPLE DATA FOR DEVELOPMENT
-- =====================================================

-- Insert sample company (France)
INSERT INTO companies (id, name, country, business_number, vat_number, email, phone, address, settings) VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'FacturePro Demo SAS',
    'FR',
    '12345678901234',
    'FR12345678901',
    'demo@facturepro.com',
    '+33 1 23 45 67 89',
    '{"street": "123 Rue de la Paix", "city": "Paris", "postalCode": "75001", "country": "France"}',
    '{"vatLabel": "TVA", "defaultVatRate": 20, "currency": "EUR", "invoicePrefix": "FA-", "quotePrefix": "DV-"}'
);

-- Insert sample user
INSERT INTO users (id, company_id, email, password_hash, first_name, last_name, role) VALUES (
    '550e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440000',
    'admin@facturepro.com',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYyj2aB8qOqGS.m', -- password: demo123
    'Admin',
    'Demo',
    'admin'
);

-- Insert sample clients
INSERT INTO clients (id, company_id, type, name, email, phone, business_number, address, billing_settings) VALUES
(
    '550e8400-e29b-41d4-a716-446655440010',
    '550e8400-e29b-41d4-a716-446655440000',
    'company',
    'Entreprise Martin SARL',
    'contact@martin-sarl.fr',
    '+33 1 23 45 67 90',
    '98765432109876',
    '{"street": "456 Avenue des Champs", "city": "Lyon", "postalCode": "69000", "country": "France"}',
    '{"paymentTerms": 30, "currency": "EUR", "language": "fr"}'
),
(
    '550e8400-e29b-41d4-a716-446655440011',
    '550e8400-e29b-41d4-a716-446655440000',
    'individual',
    'Jean Dupont',
    'jean.dupont@email.com',
    '+33 6 12 34 56 78',
    NULL,
    '{"street": "789 Rue des Exemples", "city": "Marseille", "postalCode": "13000", "country": "France"}',
    '{"paymentTerms": 15, "currency": "EUR", "language": "fr"}'
);

-- =====================================================
-- VIEWS FOR ANALYTICS
-- =====================================================

-- Vue pour les statistiques de factures
CREATE VIEW invoice_stats AS
SELECT
    company_id,
    status,
    COUNT(*) as count,
    SUM(total) as total_amount,
    AVG(total) as average_amount,
    MIN(issue_date) as first_date,
    MAX(issue_date) as last_date
FROM invoices
GROUP BY company_id, status;

-- Vue pour les statistiques de devis
CREATE VIEW quote_stats AS
SELECT
    company_id,
    status,
    COUNT(*) as count,
    SUM(total) as total_amount,
    AVG(total) as average_amount,
    MIN(quote_date) as first_date,
    MAX(quote_date) as last_date
FROM quotes
GROUP BY company_id, status;

-- Vue pour le CA mensuel
CREATE VIEW monthly_revenue AS
SELECT
    company_id,
    EXTRACT(YEAR FROM paid_at) as year,
    EXTRACT(MONTH FROM paid_at) as month,
    COUNT(*) as paid_invoices,
    SUM(total) as revenue
FROM invoices
WHERE status = 'paid' AND paid_at IS NOT NULL
GROUP BY company_id, EXTRACT(YEAR FROM paid_at), EXTRACT(MONTH FROM paid_at)
ORDER BY year DESC, month DESC;

-- =====================================================
-- FUNCTIONS FOR BUSINESS LOGIC
-- =====================================================

-- Function pour calculer le prochain numéro de facture
CREATE OR REPLACE FUNCTION get_next_invoice_number(p_company_id UUID, p_prefix VARCHAR DEFAULT 'FA-')
RETURNS VARCHAR AS $$
DECLARE
    next_number INTEGER;
    formatted_number VARCHAR;
BEGIN
    -- Compter les factures existantes pour cette entreprise
    SELECT COUNT(*) + 1 INTO next_number
    FROM invoices
    WHERE company_id = p_company_id;

    -- Formater le numéro avec des zéros
    formatted_number := p_prefix || LPAD(next_number::TEXT, 4, '0');

    RETURN formatted_number;
END;
$$ LANGUAGE plpgsql;

-- Function pour calculer le prochain numéro de devis
CREATE OR REPLACE FUNCTION get_next_quote_number(p_company_id UUID, p_prefix VARCHAR DEFAULT 'DV-')
RETURNS VARCHAR AS $$
DECLARE
    next_number INTEGER;
    formatted_number VARCHAR;
BEGIN
    -- Compter les devis existants pour cette entreprise
    SELECT COUNT(*) + 1 INTO next_number
    FROM quotes
    WHERE company_id = p_company_id;

    -- Formater le numéro avec des zéros
    formatted_number := p_prefix || LPAD(next_number::TEXT, 4, '0');

    RETURN formatted_number;
END;
$$ LANGUAGE plpgsql;

-- Function pour marquer les factures en retard
CREATE OR REPLACE FUNCTION update_overdue_invoices()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE invoices
    SET status = 'overdue'
    WHERE status = 'sent'
      AND due_date < CURRENT_DATE;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PERMISSIONS ET SÉCURITÉ
-- =====================================================

-- RLS (Row Level Security) sera ajouté dans une migration ultérieure
-- pour sécuriser l'accès multi-tenant

COMMIT;

-- Message de fin
DO $$
BEGIN
    RAISE NOTICE 'FacturePro database schema initialized successfully!';
    RAISE NOTICE 'Sample data inserted for development.';
    RAISE NOTICE 'Demo login: admin@facturepro.com / demo123';
END
$$;
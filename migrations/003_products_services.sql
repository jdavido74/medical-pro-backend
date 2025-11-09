-- Migration 003: Products and Services Catalog
-- Creates tables for product/service catalog management

-- Categories table
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(7) DEFAULT '#3B82F6' CHECK (color ~ '^#[0-9A-F]{6}$'),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(name, company_id)
);

-- Products/Services table
CREATE TABLE products_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('product', 'service')),
    unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR' CHECK (LENGTH(currency) = 3),
    unit VARCHAR(50) DEFAULT 'unité',
    sku VARCHAR(100),
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 20.00 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(sku, company_id) DEFERRABLE INITIALLY DEFERRED
);

-- Many-to-many relation between products/services and categories
CREATE TABLE product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_service_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(product_service_id, category_id)
);

-- Add product reference to document_items
ALTER TABLE document_items
ADD COLUMN product_service_id UUID REFERENCES products_services(id),
ADD COLUMN price_locked_at TIMESTAMP WITH TIME ZONE;

-- Indexes for performance
CREATE INDEX idx_categories_company_id ON categories(company_id);
CREATE INDEX idx_products_services_company_id ON products_services(company_id);
CREATE INDEX idx_products_services_type ON products_services(type);
CREATE INDEX idx_product_categories_product_service_id ON product_categories(product_service_id);
CREATE INDEX idx_product_categories_category_id ON product_categories(category_id);
CREATE INDEX idx_document_items_product_service_id ON document_items(product_service_id);

-- Update functions for automatic timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_services_updated_at BEFORE UPDATE ON products_services
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert demo categories
INSERT INTO categories (id, name, description, color, company_id) VALUES
('550e8400-e29b-41d4-a716-446655440010', 'Services Consulting', 'Services de conseil et expertise', '#10B981', '550e8400-e29b-41d4-a716-446655440000'),
('550e8400-e29b-41d4-a716-446655440011', 'Développement Web', 'Services de développement web et applications', '#3B82F6', '550e8400-e29b-41d4-a716-446655440000'),
('550e8400-e29b-41d4-a716-446655440012', 'Formation', 'Formations et ateliers', '#F59E0B', '550e8400-e29b-41d4-a716-446655440000'),
('550e8400-e29b-41d4-a716-446655440013', 'Matériel', 'Équipements et matériel', '#EF4444', '550e8400-e29b-41d4-a716-446655440000');

-- Insert demo products/services
INSERT INTO products_services (id, title, description, type, unit_price, currency, unit, sku, tax_rate, company_id) VALUES
('550e8400-e29b-41d4-a716-446655440020', 'Consultation Stratégique', 'Audit et conseil stratégique pour optimiser les processus métier', 'service', 150.00, 'EUR', 'heure', 'CONS-STRAT-001', 20.00, '550e8400-e29b-41d4-a716-446655440000'),
('550e8400-e29b-41d4-a716-446655440021', 'Développement Site Web', 'Création de site web responsive et moderne', 'service', 80.00, 'EUR', 'heure', 'DEV-WEB-001', 20.00, '550e8400-e29b-41d4-a716-446655440000'),
('550e8400-e29b-41d4-a716-446655440022', 'Formation React.js', 'Formation développement frontend avec React.js', 'service', 120.00, 'EUR', 'heure', 'FORM-REACT-001', 20.00, '550e8400-e29b-41d4-a716-446655440000'),
('550e8400-e29b-41d4-a716-446655440023', 'Licence Logiciel', 'Licence annuelle logiciel de gestion', 'product', 299.00, 'EUR', 'licence', 'LIC-SOFT-001', 20.00, '550e8400-e29b-41d4-a716-446655440000'),
('550e8400-e29b-41d4-a716-446655440024', 'Serveur VPS', 'Serveur privé virtuel hébergé', 'service', 29.99, 'EUR', 'mois', 'VPS-SERVER-001', 20.00, '550e8400-e29b-41d4-a716-446655440000');

-- Associate products/services with categories
INSERT INTO product_categories (product_service_id, category_id) VALUES
('550e8400-e29b-41d4-a716-446655440020', '550e8400-e29b-41d4-a716-446655440010'), -- Consultation -> Services Consulting
('550e8400-e29b-41d4-a716-446655440021', '550e8400-e29b-41d4-a716-446655440011'), -- Site Web -> Développement Web
('550e8400-e29b-41d4-a716-446655440022', '550e8400-e29b-41d4-a716-446655440011'), -- Formation React -> Développement Web
('550e8400-e29b-41d4-a716-446655440022', '550e8400-e29b-41d4-a716-446655440012'), -- Formation React -> Formation
('550e8400-e29b-41d4-a716-446655440023', '550e8400-e29b-41d4-a716-446655440013'), -- Licence -> Matériel
('550e8400-e29b-41d4-a716-446655440024', '550e8400-e29b-41d4-a716-446655440013'); -- VPS -> Matériel

-- Comments
COMMENT ON TABLE categories IS 'Categories for organizing products and services';
COMMENT ON TABLE products_services IS 'Catalog of products and services offered by companies';
COMMENT ON TABLE product_categories IS 'Many-to-many relationship between products/services and categories';
COMMENT ON COLUMN document_items.product_service_id IS 'Reference to catalog item if this line comes from catalog';
COMMENT ON COLUMN document_items.price_locked_at IS 'Timestamp when price was locked for this document item';
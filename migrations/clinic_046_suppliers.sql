-- Migration: clinic_046_suppliers
-- Purpose: Add suppliers management and product-supplier associations
-- Description: Creates suppliers table and product_suppliers junction table
--              Removes provenance field (replaced by supplier information)

-- ============================================
-- 1. CREATE SUPPLIERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Company ownership (multi-tenant)
    company_id UUID NOT NULL,

    -- Supplier information
    name VARCHAR(200) NOT NULL,

    -- Address
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    postal_code VARCHAR(20),
    state VARCHAR(100),
    country VARCHAR(100),
    country_code CHAR(2),  -- ISO 3166-1 alpha-2

    -- Contact information
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),

    -- Primary contact person
    contact_name VARCHAR(200),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),

    -- Additional info
    notes TEXT,
    tax_id VARCHAR(50),  -- VAT number, SIRET, etc.

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_company_id ON suppliers(company_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_country ON suppliers(country_code);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);

-- Comments
COMMENT ON TABLE suppliers IS 'Suppliers/vendors for products and services';
COMMENT ON COLUMN suppliers.company_id IS 'Tenant company ID for multi-tenant isolation';
COMMENT ON COLUMN suppliers.country_code IS 'ISO 3166-1 alpha-2 country code (e.g., FR, ES, US)';
COMMENT ON COLUMN suppliers.tax_id IS 'Tax identification number (VAT, SIRET, EIN, etc.)';

-- ============================================
-- 2. CREATE PRODUCT-SUPPLIER JUNCTION TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS product_suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign keys
    product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

    -- Relationship metadata
    is_primary BOOLEAN DEFAULT false,  -- Primary supplier for this product
    supplier_sku VARCHAR(100),         -- Supplier's product code
    unit_cost DECIMAL(10, 2),          -- Cost from this supplier
    currency CHAR(3) DEFAULT 'EUR',
    min_order_quantity INTEGER,
    lead_time_days INTEGER,            -- Delivery time in days
    notes TEXT,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraint: one product-supplier pair
    UNIQUE(product_id, supplier_id)
);

-- Indexes for product_suppliers
CREATE INDEX IF NOT EXISTS idx_product_suppliers_product ON product_suppliers(product_id);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier ON product_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_primary ON product_suppliers(is_primary) WHERE is_primary = true;

-- Comments
COMMENT ON TABLE product_suppliers IS 'Junction table linking products to their suppliers';
COMMENT ON COLUMN product_suppliers.is_primary IS 'Indicates if this is the primary/preferred supplier';
COMMENT ON COLUMN product_suppliers.supplier_sku IS 'Product reference code used by the supplier';
COMMENT ON COLUMN product_suppliers.lead_time_days IS 'Expected delivery time in business days';

-- ============================================
-- 3. REMOVE PROVENANCE COLUMN (replaced by suppliers)
-- ============================================
-- Note: We keep the column for now but it's deprecated
-- ALTER TABLE products_services DROP COLUMN IF EXISTS provenance;
-- Uncomment above line after data migration if needed

-- Add comment to mark as deprecated
COMMENT ON COLUMN products_services.provenance IS 'DEPRECATED: Use suppliers table instead. Will be removed in future migration.';

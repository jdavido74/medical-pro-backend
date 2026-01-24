-- Migration: Create products_services table for clinic database
-- Purpose: Full catalog support with medical-specific fields
-- Note: This is for clinic databases that don't have the products_services table yet

-- Create categories table if not exists
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(7) DEFAULT '#3B82F6',
    company_id UUID, -- Optional, for compatibility
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create products_services table with all medical fields
CREATE TABLE IF NOT EXISTS products_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Basic fields
    title VARCHAR(200) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'product' CHECK (type IN ('product', 'service')),

    -- Medical item type (more specific than product/service)
    item_type VARCHAR(20) NOT NULL DEFAULT 'product' CHECK (item_type IN ('product', 'medication', 'treatment', 'service')),

    -- Pricing
    unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    unit VARCHAR(50) DEFAULT 'unité',
    sku VARCHAR(100),
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 20.00 CHECK (tax_rate >= 0 AND tax_rate <= 100),

    -- Ownership
    company_id UUID, -- For multi-tenant support

    -- Status
    is_active BOOLEAN DEFAULT TRUE,

    -- Duration in minutes (for services and treatments that impact appointments)
    duration INTEGER CHECK (duration IS NULL OR (duration >= 5 AND duration <= 480)),

    -- Preparation time before treatment (minutes)
    prep_before INTEGER DEFAULT 0 CHECK (prep_before >= 0 AND prep_before <= 120),

    -- Time after treatment (minutes)
    prep_after INTEGER DEFAULT 0 CHECK (prep_after >= 0 AND prep_after <= 120),

    -- Dosage amount (for medications and treatments)
    dosage DECIMAL(10,2) CHECK (dosage IS NULL OR dosage >= 0),

    -- Dosage unit (mg, ml, g, ui, mcg)
    dosage_unit VARCHAR(10) CHECK (dosage_unit IS NULL OR dosage_unit IN ('mg', 'ml', 'g', 'ui', 'mcg')),

    -- Volume in ml (for treatments)
    volume DECIMAL(10,2) CHECK (volume IS NULL OR volume >= 0),

    -- Provenance/origin (for medications and treatments)
    provenance VARCHAR(200),

    -- Can this treatment overlap with others (no machine required)
    is_overlappable BOOLEAN DEFAULT false,

    -- Machine type required (for planning integration)
    machine_type_id UUID,

    -- Family/Variant support
    parent_id UUID REFERENCES products_services(id) ON DELETE CASCADE,
    is_family BOOLEAN DEFAULT false,
    is_variant BOOLEAN DEFAULT false,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create product_categories junction table
CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_service_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(product_service_id, category_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_products_services_company_id ON products_services(company_id);
CREATE INDEX IF NOT EXISTS idx_products_services_type ON products_services(type);
CREATE INDEX IF NOT EXISTS idx_products_services_item_type ON products_services(item_type);
CREATE INDEX IF NOT EXISTS idx_products_services_parent_id ON products_services(parent_id);
CREATE INDEX IF NOT EXISTS idx_products_services_machine_type ON products_services(machine_type_id);
CREATE INDEX IF NOT EXISTS idx_products_services_is_family ON products_services(is_family) WHERE is_family = true;
CREATE INDEX IF NOT EXISTS idx_products_services_is_variant ON products_services(is_variant) WHERE is_variant = true;
CREATE INDEX IF NOT EXISTS idx_product_categories_product_service_id ON product_categories(product_service_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category_id ON product_categories(category_id);

-- Create unique index for SKU per company
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_services_sku_company
    ON products_services(sku, company_id)
    WHERE sku IS NOT NULL;

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_products_services_updated_at ON products_services;
CREATE TRIGGER update_products_services_updated_at
    BEFORE UPDATE ON products_services
    FOR EACH ROW EXECUTE FUNCTION update_products_updated_at();

DROP TRIGGER IF EXISTS update_categories_updated_at ON categories;
CREATE TRIGGER update_categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_products_updated_at();

-- Comments for documentation
COMMENT ON TABLE products_services IS 'Catalog of products, medications, treatments, and services';
COMMENT ON COLUMN products_services.item_type IS 'Medical item type: product (generic), medication, treatment, service';
COMMENT ON COLUMN products_services.duration IS 'Duration in minutes for services/treatments (impacts appointment scheduling)';
COMMENT ON COLUMN products_services.prep_before IS 'Preparation time before treatment in minutes';
COMMENT ON COLUMN products_services.prep_after IS 'Time needed after treatment in minutes';
COMMENT ON COLUMN products_services.dosage IS 'Dosage amount for medications/treatments';
COMMENT ON COLUMN products_services.dosage_unit IS 'Unit of dosage: mg, ml, g, ui (international units), mcg';
COMMENT ON COLUMN products_services.volume IS 'Volume in ml for treatments';
COMMENT ON COLUMN products_services.provenance IS 'Origin/provenance of medication or treatment';
COMMENT ON COLUMN products_services.is_overlappable IS 'If true, treatment can overlap with others (no machine required)';
COMMENT ON COLUMN products_services.machine_type_id IS 'Required machine type for this treatment (FK to machine_types when created)';
COMMENT ON COLUMN products_services.parent_id IS 'Parent item ID for variants (self-reference)';
COMMENT ON COLUMN products_services.is_family IS 'True if this item is a family with variants';
COMMENT ON COLUMN products_services.is_variant IS 'True if this item is a variant of a family';

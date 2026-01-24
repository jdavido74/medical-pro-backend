-- Migration: Add medical-specific fields to products_services catalog
-- Purpose: Support medication, treatment, service types with full attributes
-- for appointment planning and clinic management

-- Add new columns to products_services table
ALTER TABLE products_services
  -- Medical item type (more specific than product/service)
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) DEFAULT 'product'
    CHECK (item_type IN ('product', 'medication', 'treatment', 'service')),

  -- Duration in minutes (for services and treatments that impact appointments)
  ADD COLUMN IF NOT EXISTS duration INTEGER CHECK (duration IS NULL OR (duration >= 5 AND duration <= 480)),

  -- Preparation time before treatment (minutes)
  ADD COLUMN IF NOT EXISTS prep_before INTEGER DEFAULT 0 CHECK (prep_before >= 0 AND prep_before <= 120),

  -- Time after treatment (minutes)
  ADD COLUMN IF NOT EXISTS prep_after INTEGER DEFAULT 0 CHECK (prep_after >= 0 AND prep_after <= 120),

  -- Dosage amount (for medications and treatments)
  ADD COLUMN IF NOT EXISTS dosage DECIMAL(10,2) CHECK (dosage IS NULL OR dosage >= 0),

  -- Dosage unit (mg, ml, g, ui, mcg)
  ADD COLUMN IF NOT EXISTS dosage_unit VARCHAR(10) CHECK (dosage_unit IS NULL OR dosage_unit IN ('mg', 'ml', 'g', 'ui', 'mcg')),

  -- Volume in ml (for treatments)
  ADD COLUMN IF NOT EXISTS volume DECIMAL(10,2) CHECK (volume IS NULL OR volume >= 0),

  -- Provenance/origin (for medications and treatments)
  ADD COLUMN IF NOT EXISTS provenance VARCHAR(200),

  -- Can this treatment overlap with others (no machine required)
  ADD COLUMN IF NOT EXISTS is_overlappable BOOLEAN DEFAULT false,

  -- Machine type required (will reference machine_types table later)
  ADD COLUMN IF NOT EXISTS machine_type_id UUID,

  -- Family/Variant support
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES products_services(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_family BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_variant BOOLEAN DEFAULT false;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_products_services_item_type ON products_services(item_type);
CREATE INDEX IF NOT EXISTS idx_products_services_parent_id ON products_services(parent_id);
CREATE INDEX IF NOT EXISTS idx_products_services_machine_type ON products_services(machine_type_id);
CREATE INDEX IF NOT EXISTS idx_products_services_is_family ON products_services(is_family) WHERE is_family = true;
CREATE INDEX IF NOT EXISTS idx_products_services_is_variant ON products_services(is_variant) WHERE is_variant = true;

-- Update existing records: map 'service' type to 'service' item_type
UPDATE products_services SET item_type = 'service' WHERE type = 'service' AND item_type = 'product';

-- Comments for documentation
COMMENT ON COLUMN products_services.item_type IS 'Medical item type: product (generic), medication, treatment, service';
COMMENT ON COLUMN products_services.duration IS 'Duration in minutes for services/treatments (impacts appointment scheduling)';
COMMENT ON COLUMN products_services.prep_before IS 'Preparation time before treatment in minutes';
COMMENT ON COLUMN products_services.prep_after IS 'Time needed after treatment in minutes';
COMMENT ON COLUMN products_services.dosage IS 'Dosage amount for medications/treatments';
COMMENT ON COLUMN products_services.dosage_unit IS 'Unit of dosage: mg, ml, g, ui (international units), mcg';
COMMENT ON COLUMN products_services.volume IS 'Volume in ml for treatments';
COMMENT ON COLUMN products_services.provenance IS 'Origin/provenance of medication or treatment';
COMMENT ON COLUMN products_services.is_overlappable IS 'If true, treatment can overlap with others (no machine required)';
COMMENT ON COLUMN products_services.machine_type_id IS 'Required machine type for this treatment (FK to machine_types)';
COMMENT ON COLUMN products_services.parent_id IS 'Parent item ID for variants (self-reference)';
COMMENT ON COLUMN products_services.is_family IS 'True if this item is a family with variants';
COMMENT ON COLUMN products_services.is_variant IS 'True if this item is a variant of a family';

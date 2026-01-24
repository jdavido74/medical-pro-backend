-- Migration: Add tags system for product grouping
-- Replaces family/variant hierarchy with flexible tagging

-- Create tags table
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) DEFAULT '#6366F1',
    description TEXT,
    company_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(name, company_id)
);

-- Create junction table for many-to-many relationship
CREATE TABLE IF NOT EXISTS product_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_service_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(product_service_id, tag_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tags_company_id ON tags(company_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_product_tags_product_id ON product_tags(product_service_id);
CREATE INDEX IF NOT EXISTS idx_product_tags_tag_id ON product_tags(tag_id);

-- Trigger for updated_at on tags
DROP TRIGGER IF EXISTS update_tags_updated_at ON tags;
CREATE TRIGGER update_tags_updated_at
    BEFORE UPDATE ON tags
    FOR EACH ROW EXECUTE FUNCTION update_products_updated_at();

-- Comments
COMMENT ON TABLE tags IS 'Tags for grouping and organizing products/services';
COMMENT ON TABLE product_tags IS 'Many-to-many relationship between products and tags';
COMMENT ON COLUMN tags.name IS 'Tag name (unique per company)';
COMMENT ON COLUMN tags.color IS 'Display color for the tag';

-- Migration: Create AppointmentItems table
-- Purpose: Products/Services selected during an appointment

CREATE TABLE IF NOT EXISTS appointment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  product_service_id UUID NOT NULL REFERENCES products_services(id) ON DELETE RESTRICT,

  -- Pricing
  quantity DECIMAL(10, 2) NOT NULL,
  unit_price DECIMAL(12, 2) NOT NULL,
  total DECIMAL(12, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,

  -- Patient acceptance (independent per item!)
  status VARCHAR(20) DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'refused', 'completed')),

  -- Notes
  notes TEXT,

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_appointment_items_company_id ON appointment_items(company_id);
CREATE INDEX idx_appointment_items_appointment_id ON appointment_items(appointment_id);
CREATE INDEX idx_appointment_items_product_service_id ON appointment_items(product_service_id);
CREATE INDEX idx_appointment_items_status ON appointment_items(status);
CREATE INDEX idx_appointment_items_deleted_at ON appointment_items(deleted_at);

-- Migration: Add planning fields to appointments table
-- Purpose: Support machine-based treatments and enhanced appointment planning

-- Add category field to distinguish treatment vs consultation
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'consultation';

-- Add constraint for category values
DO $$ BEGIN
  ALTER TABLE appointments
  ADD CONSTRAINT appointments_category_check
  CHECK (category IN ('treatment', 'consultation'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add machine_id for treatment appointments
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES machines(id) ON DELETE SET NULL;

-- Add assistant_id (informational, for treatments)
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES healthcare_providers(id) ON DELETE SET NULL;

-- Add service_id to link to catalog (products_services)
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES products_services(id) ON DELETE SET NULL;

-- Add color for calendar display (optional override)
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS color VARCHAR(7);

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_appointments_category ON appointments(category);
CREATE INDEX IF NOT EXISTS idx_appointments_machine_id ON appointments(machine_id);
CREATE INDEX IF NOT EXISTS idx_appointments_service_id ON appointments(service_id);
CREATE INDEX IF NOT EXISTS idx_appointments_machine_date ON appointments(machine_id, appointment_date) WHERE machine_id IS NOT NULL;

-- Update existing appointments to be consultations (backwards compatibility)
UPDATE appointments SET category = 'consultation' WHERE category IS NULL;

-- Comments
COMMENT ON COLUMN appointments.category IS 'Appointment category: treatment (machine-based) or consultation (practitioner-based)';
COMMENT ON COLUMN appointments.machine_id IS 'Machine used for treatment appointments';
COMMENT ON COLUMN appointments.assistant_id IS 'Assistant/operator for treatment (informational)';
COMMENT ON COLUMN appointments.service_id IS 'Reference to catalog service/treatment';
COMMENT ON COLUMN appointments.color IS 'Optional color override for calendar display';

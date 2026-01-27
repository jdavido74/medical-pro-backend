-- Migration: clinic_045_linked_appointments
-- Purpose: Add support for linked appointments (multi-treatment sessions)
-- Description: Allows creating a chain of appointments that are linked together
--              for multi-treatment sessions where different treatments are performed
--              sequentially on different machines

-- Add linked_appointment_id column to reference the parent/first appointment in a chain
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS linked_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

-- Add link_sequence to track the order of appointments in a chain (1, 2, 3, etc.)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS link_sequence INTEGER;

-- Create index for efficient querying of linked appointments
CREATE INDEX IF NOT EXISTS idx_appointments_linked ON appointments(linked_appointment_id);

-- Comment on new columns
COMMENT ON COLUMN appointments.linked_appointment_id IS 'References the parent/first appointment in a multi-treatment chain. NULL for standalone or parent appointments.';
COMMENT ON COLUMN appointments.link_sequence IS 'Order of this appointment in a multi-treatment chain (1 for first/parent, 2 for second, etc.)';

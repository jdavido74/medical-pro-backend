-- Migration: Create Appointments table
-- Purpose: Store medical appointments/consultations

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,

  -- Timing
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,

  -- Content
  reason VARCHAR(500),
  notes JSONB DEFAULT '{}',

  -- Status
  status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'cancelled', 'completed', 'no-show')),

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_timing CHECK (end_time > start_time)
);

-- Indexes
CREATE INDEX idx_appointments_company_id ON appointments(company_id);
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_appointments_practitioner_id ON appointments(practitioner_id);
CREATE INDEX idx_appointments_start_time ON appointments(start_time);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_deleted_at ON appointments(deleted_at);
CREATE INDEX idx_appointments_date_range ON appointments(company_id, start_time, end_time);

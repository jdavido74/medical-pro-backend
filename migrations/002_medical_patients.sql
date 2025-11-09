-- Migration: Create Patients table
-- Purpose: Store patient medical records with GDPR compliance

CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Personal info
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),

  -- Medical info
  date_of_birth DATE,
  gender VARCHAR(10) CHECK (gender IN ('M', 'F', 'O', 'N/A')),
  social_security_number VARCHAR(255),  -- Encrypted
  patient_number VARCHAR(50),  -- Unique per company

  -- Medical data
  medical_history JSONB DEFAULT '{}',
  address JSONB DEFAULT '{}',
  emergency_contact JSONB DEFAULT '{}',
  insurance_info JSONB DEFAULT '{}',

  -- Flags
  is_incomplete BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),

  -- Notes
  notes TEXT,

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique index (allows NULL for soft deletes)
CREATE UNIQUE INDEX idx_patient_number_per_company ON patients(company_id, patient_number) WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX idx_patients_company_id ON patients(company_id);
CREATE INDEX idx_patients_status ON patients(status);
CREATE INDEX idx_patients_deleted_at ON patients(deleted_at);
CREATE INDEX idx_patients_email ON patients(email);
CREATE INDEX idx_patients_full_name ON patients(first_name, last_name);
CREATE INDEX idx_patients_patient_number ON patients(patient_number);

-- Migration: Create Practitioners table
-- Purpose: Store practitioner/doctor information linked to User

CREATE TABLE IF NOT EXISTS practitioners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- License info
  license_number VARCHAR(100) NOT NULL,
  license_expiry DATE,

  -- Professional info
  speciality JSONB DEFAULT '[]',  -- Array: ["dentiste", "kiné", ...]
  bio TEXT,
  photo_url VARCHAR(255),

  -- Working hours
  working_hours JSONB DEFAULT '{}',  -- { "monday": { "start": "09:00", "end": "18:00" }, ... }

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique index for license per company (allowing NULL for soft deletes)
CREATE UNIQUE INDEX idx_license_per_company ON practitioners(company_id, license_number) WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX idx_practitioners_company_id ON practitioners(company_id);
CREATE INDEX idx_practitioners_user_id ON practitioners(user_id);
CREATE INDEX idx_practitioners_is_active ON practitioners(is_active);
CREATE INDEX idx_practitioners_deleted_at ON practitioners(deleted_at);
CREATE INDEX idx_practitioners_license_number ON practitioners(license_number);

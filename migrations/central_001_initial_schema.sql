-- Central Database Schema
-- Purpose: Manage clinics, users, and their database connections
-- This database is shared across all clinics and handles authentication/authorization

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Companies (Clinics) table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Company info
  name VARCHAR(255) NOT NULL,
  description TEXT,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),

  -- Database connection info
  db_host VARCHAR(255) NOT NULL DEFAULT 'localhost',
  db_port INTEGER NOT NULL DEFAULT 5432,
  db_name VARCHAR(100) NOT NULL UNIQUE,  -- e.g., medicalpro_clinic_<uuid>
  db_user VARCHAR(100) NOT NULL DEFAULT 'medicalpro',
  db_password VARCHAR(255) NOT NULL,

  -- Address
  address JSONB DEFAULT '{}',  -- { street, city, postal_code, country }

  -- Configuration
  is_active BOOLEAN DEFAULT TRUE,
  subscription_status VARCHAR(50) DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'suspended', 'cancelled')),
  subscription_expiry DATE,

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Global users table (platform administrators)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,

  -- User info
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),

  -- Role (only for central users)
  role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'admin', 'support', 'physician', 'practitioner', 'secretary', 'readonly')) DEFAULT 'admin',

  -- Permissions (JSON for flexibility)
  permissions JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP,

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Global audit log
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Action details
  action VARCHAR(100) NOT NULL,  -- 'company_created', 'company_updated', 'user_login', etc
  entity_type VARCHAR(50),        -- 'company', 'user', 'database', etc
  entity_id UUID,

  -- Data change
  old_data JSONB,
  new_data JSONB,

  -- Context
  ip_address INET,
  user_agent VARCHAR(500),

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_companies_is_active ON companies(is_active);
CREATE INDEX idx_companies_deleted_at ON companies(deleted_at);
CREATE INDEX idx_companies_subscription_status ON companies(subscription_status);

CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_deleted_at ON users(deleted_at);

CREATE INDEX idx_audit_logs_company_id ON audit_logs(company_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Unique index for clinic database names
CREATE UNIQUE INDEX idx_clinic_db_name ON companies(db_name) WHERE deleted_at IS NULL;

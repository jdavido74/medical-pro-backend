-- Migration: Create scheduled_jobs table
-- Generic job scheduler for background tasks (reminders, actions, etc.)

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create scheduled_jobs table
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Job type identifier
    job_type VARCHAR(50) NOT NULL,
    -- Values: 'appointment_reminder', 'appointment_confirmation', 'send_consent', 'execute_action', etc.

    -- Reference to the related entity
    reference_id UUID,
    reference_type VARCHAR(50),
    -- e.g., reference_type='appointment', reference_id=<appointment_id>

    -- Scheduling
    execute_at TIMESTAMP NOT NULL,
    executed_at TIMESTAMP,

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    -- Values: 'scheduled', 'processing', 'completed', 'failed', 'cancelled'

    -- Retry handling
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_error TEXT,

    -- Data
    payload JSONB DEFAULT '{}',
    result JSONB DEFAULT '{}',

    -- Clinic context (for multi-tenant)
    clinic_id VARCHAR(100),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient job processing
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_execute ON scheduled_jobs(execute_at)
    WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_type ON scheduled_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_reference ON scheduled_jobs(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_clinic ON scheduled_jobs(clinic_id);

-- Add constraint for valid status values
DO $$ BEGIN
    ALTER TABLE scheduled_jobs
    ADD CONSTRAINT chk_job_status
    CHECK (status IN ('scheduled', 'processing', 'completed', 'failed', 'cancelled'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

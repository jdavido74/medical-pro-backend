-- Email Verification Migration
-- Adds email verification fields to support registration email confirmation flow

-- Add columns to users table
ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN email_verification_token VARCHAR(500) NULL;
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL;

-- Add index on email_verified for faster queries
CREATE INDEX idx_email_verified ON users(email_verified);

-- Add index on email_verification_token for token lookups
CREATE INDEX idx_email_verification_token ON users(email_verification_token);

-- Add comments to columns
COMMENT ON COLUMN users.email_verified IS 'Email verification status';
COMMENT ON COLUMN users.email_verification_token IS 'JWT token for email verification (expires in 24h)';
COMMENT ON COLUMN users.email_verified_at IS 'Timestamp when email was verified';

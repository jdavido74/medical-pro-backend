-- central_007_add_password_reset_fields.sql
-- Add password reset token fields to users table for forgot-password flow

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_password_reset_token
  ON users(password_reset_token) WHERE password_reset_token IS NOT NULL;

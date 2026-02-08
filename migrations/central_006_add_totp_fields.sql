-- =============================================================================
-- Migration: central_006_add_totp_fields
-- Description: Add TOTP (2FA) support fields to users table
-- =============================================================================

-- Add TOTP fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMP;

-- Index for quick lookup of 2FA enabled users
CREATE INDEX IF NOT EXISTS idx_users_totp_enabled ON users(totp_enabled) WHERE totp_enabled = true;

-- Comments
COMMENT ON COLUMN users.totp_enabled IS 'Whether TOTP 2FA is enabled for this user';
COMMENT ON COLUMN users.totp_secret IS 'Encrypted TOTP secret key for authenticator apps';
COMMENT ON COLUMN users.totp_backup_codes IS 'Array of hashed backup codes for account recovery';
COMMENT ON COLUMN users.totp_enabled_at IS 'When 2FA was enabled';

-- Add invitation and account status fields to healthcare_providers
-- Date: 2024-12-08

-- 1. Add account_status column
ALTER TABLE healthcare_providers
ADD COLUMN IF NOT EXISTS account_status VARCHAR(50) DEFAULT 'active'
CHECK (account_status IN ('pending', 'active', 'suspended', 'locked'));

-- 2. Add invitation_token column
ALTER TABLE healthcare_providers
ADD COLUMN IF NOT EXISTS invitation_token VARCHAR(255);

-- 3. Add invitation_expires_at column
ALTER TABLE healthcare_providers
ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMP;

-- 4. Make password_hash nullable (pour permettre la création sans mot de passe)
ALTER TABLE healthcare_providers
ALTER COLUMN password_hash DROP NOT NULL;

-- 5. Add index on invitation_token for faster lookups
CREATE INDEX IF NOT EXISTS idx_healthcare_providers_invitation_token
ON healthcare_providers(invitation_token)
WHERE invitation_token IS NOT NULL;

-- 6. Add index on account_status
CREATE INDEX IF NOT EXISTS idx_healthcare_providers_account_status
ON healthcare_providers(account_status);

-- Comment:
-- - account_status permet de tracker l'état du compte (pending = en attente d'activation par l'utilisateur)
-- - invitation_token est utilisé pour sécuriser le lien d'invitation
-- - invitation_expires_at définit la durée de validité du token (généralement 7 jours)
-- - password_hash nullable permet de créer un utilisateur qui définira son mot de passe plus tard

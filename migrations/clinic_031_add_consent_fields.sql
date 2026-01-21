-- Migration: Add missing columns to consents table
-- Purpose: Align frontend form fields with database schema
-- Fields: purpose, is_required, expires_at, witness (JSONB), specific_details (JSONB)

-- Add purpose column (separate from description)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consents' AND column_name = 'purpose'
    ) THEN
        ALTER TABLE consents ADD COLUMN purpose TEXT;
        RAISE NOTICE 'Column purpose added to consents table';
    ELSE
        RAISE NOTICE 'Column purpose already exists in consents table';
    END IF;
END $$;

-- Add is_required column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consents' AND column_name = 'is_required'
    ) THEN
        ALTER TABLE consents ADD COLUMN is_required BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Column is_required added to consents table';
    ELSE
        RAISE NOTICE 'Column is_required already exists in consents table';
    END IF;
END $$;

-- Add expires_at column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consents' AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE consents ADD COLUMN expires_at TIMESTAMP;
        RAISE NOTICE 'Column expires_at added to consents table';
    ELSE
        RAISE NOTICE 'Column expires_at already exists in consents table';
    END IF;
END $$;

-- Add witness JSONB column (for verbal consents)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consents' AND column_name = 'witness'
    ) THEN
        ALTER TABLE consents ADD COLUMN witness JSONB;
        RAISE NOTICE 'Column witness added to consents table';
    ELSE
        RAISE NOTICE 'Column witness already exists in consents table';
    END IF;
END $$;

-- Add specific_details JSONB column (for medical-specific consents)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consents' AND column_name = 'specific_details'
    ) THEN
        ALTER TABLE consents ADD COLUMN specific_details JSONB;
        RAISE NOTICE 'Column specific_details added to consents table';
    ELSE
        RAISE NOTICE 'Column specific_details already exists in consents table';
    END IF;
END $$;

-- Add revocation_reason column (for rejected/revoked consents)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consents' AND column_name = 'revocation_reason'
    ) THEN
        ALTER TABLE consents ADD COLUMN revocation_reason TEXT;
        RAISE NOTICE 'Column revocation_reason added to consents table';
    ELSE
        RAISE NOTICE 'Column revocation_reason already exists in consents table';
    END IF;
END $$;

-- Add created_by column (who created the consent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consents' AND column_name = 'created_by'
    ) THEN
        ALTER TABLE consents ADD COLUMN created_by UUID;
        RAISE NOTICE 'Column created_by added to consents table';
    ELSE
        RAISE NOTICE 'Column created_by already exists in consents table';
    END IF;
END $$;

-- Create index on expires_at for filtering expired consents
CREATE INDEX IF NOT EXISTS idx_consents_expires_at ON consents(expires_at);

-- Create GIN index for witness JSONB searches
CREATE INDEX IF NOT EXISTS idx_consents_witness_gin ON consents USING GIN (witness);

-- Create GIN index for specific_details JSONB searches
CREATE INDEX IF NOT EXISTS idx_consents_specific_details_gin ON consents USING GIN (specific_details);

-- Add comments for documentation
COMMENT ON COLUMN consents.purpose IS 'Finalité du consentement (RGPD: soins, recherche, marketing, etc.)';
COMMENT ON COLUMN consents.is_required IS 'Indique si le consentement est obligatoire';
COMMENT ON COLUMN consents.expires_at IS 'Date d''expiration du consentement';
COMMENT ON COLUMN consents.witness IS 'Informations témoin pour consentement verbal: { name, role, signature }';
COMMENT ON COLUMN consents.specific_details IS 'Détails spécifiques pour soins médicaux: { procedure, risks, alternatives, expectedResults }';
COMMENT ON COLUMN consents.revocation_reason IS 'Raison de révocation du consentement';
COMMENT ON COLUMN consents.created_by IS 'UUID du praticien qui a créé le consentement';

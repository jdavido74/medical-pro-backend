-- Migration: Add multilingual support for consent templates
-- Purpose: Allow consent templates to have translations in multiple languages

-- Add default_language to consent_templates if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'consent_templates' AND column_name = 'default_language') THEN
    ALTER TABLE consent_templates ADD COLUMN default_language VARCHAR(5) DEFAULT 'fr';
  END IF;
END $$;

-- ConsentTemplateTranslations: Store translations for each template
CREATE TABLE IF NOT EXISTS consent_template_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_template_id UUID NOT NULL REFERENCES consent_templates(id) ON DELETE CASCADE,

  -- Language code (ISO 639-1: 'fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ar', etc.)
  language_code VARCHAR(5) NOT NULL,

  -- Translated content
  title VARCHAR(255) NOT NULL,
  description TEXT,
  terms TEXT NOT NULL,

  -- Translator info (optional audit)
  translated_by UUID,  -- User who created the translation

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Unique constraint: one translation per language per template
  CONSTRAINT uk_template_language UNIQUE (consent_template_id, language_code)
);

-- Add language_code to consents to track which language was used for signature
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'consents' AND column_name = 'language_code') THEN
    ALTER TABLE consents ADD COLUMN language_code VARCHAR(5) DEFAULT 'fr';
  END IF;
END $$;

-- Add template_version to consents to track which version was signed (for historization)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'consents' AND column_name = 'template_version') THEN
    ALTER TABLE consents ADD COLUMN template_version VARCHAR(20);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_consent_template_translations_template_id
  ON consent_template_translations(consent_template_id);
CREATE INDEX IF NOT EXISTS idx_consent_template_translations_language
  ON consent_template_translations(language_code);
CREATE INDEX IF NOT EXISTS idx_consents_language_code
  ON consents(language_code);

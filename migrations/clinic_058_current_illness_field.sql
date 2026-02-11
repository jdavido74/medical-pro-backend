-- clinic_058_current_illness_field.sql
-- Add current_illness TEXT column to medical_records table
-- Free-form textarea for describing the current illness (separate from chief_complaint)

ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS current_illness TEXT;

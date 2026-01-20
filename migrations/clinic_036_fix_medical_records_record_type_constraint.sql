-- Migration: clinic_036_fix_medical_records_record_type_constraint.sql
-- Description: Update record_type constraint to match validation schema
-- Date: 2026-01-20

-- =====================================================
-- FIX: record_type constraint mismatch between DB and validation schema
-- DB allows: consultation, urgence, controle, certificat, ordonnance
-- Schema allows: consultation, examination, treatment, follow_up, emergency, prescription, lab_result, imaging, note
-- =====================================================

-- Step 1: Drop the existing constraint
ALTER TABLE medical_records DROP CONSTRAINT IF EXISTS medical_records_record_type_check;

-- Step 2: Add new constraint with all allowed types
-- Keep both old and new values for backward compatibility
ALTER TABLE medical_records ADD CONSTRAINT medical_records_record_type_check
CHECK (record_type IN (
  -- New standard types
  'consultation',
  'examination',
  'treatment',
  'follow_up',
  'emergency',
  'prescription',
  'lab_result',
  'imaging',
  'note',
  -- Legacy types for backward compatibility
  'urgence',
  'controle',
  'certificat',
  'ordonnance'
));

-- Step 3: Migrate old types to new ones (optional, can be done later)
-- UPDATE medical_records SET record_type = 'emergency' WHERE record_type = 'urgence';
-- UPDATE medical_records SET record_type = 'follow_up' WHERE record_type = 'controle';
-- UPDATE medical_records SET record_type = 'prescription' WHERE record_type = 'ordonnance';

-- Verify the change
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'medical_records'::regclass
  AND conname = 'medical_records_record_type_check';

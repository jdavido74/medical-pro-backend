-- Migration: Fix prescriptions schema to align with Sequelize model
-- Addresses column name mismatches and missing columns

-- 1. Add facility_id column (used by model but missing in DB)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'prescriptions' AND column_name = 'facility_id') THEN
    ALTER TABLE prescriptions ADD COLUMN facility_id UUID;
    -- Add foreign key constraint
    ALTER TABLE prescriptions ADD CONSTRAINT fk_prescriptions_facility
      FOREIGN KEY (facility_id) REFERENCES medical_facilities(id) ON DELETE CASCADE;
    -- Create index
    CREATE INDEX IF NOT EXISTS idx_prescriptions_facility ON prescriptions(facility_id);
  END IF;
END $$;

-- 2. Rename treatments to medications (if treatments exists and medications doesn't)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'prescriptions' AND column_name = 'treatments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'prescriptions' AND column_name = 'medications') THEN
    ALTER TABLE prescriptions RENAME COLUMN treatments TO medications;
  END IF;
END $$;

-- 3. Rename visit_date to prescribed_date (if visit_date exists and prescribed_date doesn't)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'prescriptions' AND column_name = 'visit_date')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'prescriptions' AND column_name = 'prescribed_date') THEN
    ALTER TABLE prescriptions RENAME COLUMN visit_date TO prescribed_date;
  END IF;
END $$;

-- 4. Add instructions column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'prescriptions' AND column_name = 'instructions') THEN
    ALTER TABLE prescriptions ADD COLUMN instructions TEXT;
  END IF;
END $$;

-- 5. Add renewable column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'prescriptions' AND column_name = 'renewable') THEN
    ALTER TABLE prescriptions ADD COLUMN renewable BOOLEAN DEFAULT false;
  END IF;
END $$;

-- 6. Add renewals_remaining column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'prescriptions' AND column_name = 'renewals_remaining') THEN
    ALTER TABLE prescriptions ADD COLUMN renewals_remaining INTEGER DEFAULT 0;
  END IF;
END $$;

-- 7. Update status constraint to include all new statuses
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_status_check;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_status_check
  CHECK (status IN ('draft', 'active', 'finalized', 'printed', 'dispensed', 'expired', 'cancelled'));

-- 8. Ensure provider_id can be nullable (some prescriptions might not have provider assigned initially)
ALTER TABLE prescriptions ALTER COLUMN provider_id DROP NOT NULL;

-- 9. Ensure medical_record_id can be nullable (standalone prescriptions)
ALTER TABLE prescriptions ALTER COLUMN medical_record_id DROP NOT NULL;

-- 10. Update index on prescribed_date if renamed
DROP INDEX IF EXISTS idx_prescriptions_visit_date;
CREATE INDEX IF NOT EXISTS idx_prescriptions_prescribed_date ON prescriptions(prescribed_date);

-- Comments for documentation
COMMENT ON COLUMN prescriptions.facility_id IS 'Reference to the medical facility';
COMMENT ON COLUMN prescriptions.medications IS 'JSONB array of medications/treatments prescribed';
COMMENT ON COLUMN prescriptions.prescribed_date IS 'Date when prescription was written';
COMMENT ON COLUMN prescriptions.instructions IS 'Instructions for pharmacist or patient';
COMMENT ON COLUMN prescriptions.renewable IS 'Whether prescription can be renewed';
COMMENT ON COLUMN prescriptions.renewals_remaining IS 'Number of remaining renewals allowed';

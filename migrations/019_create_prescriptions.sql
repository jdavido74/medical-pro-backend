-- Migration 019: Create prescriptions table for medical prescriptions/ordonnances
-- Each prescription is linked to a medical record and traceable

CREATE TABLE IF NOT EXISTS prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relations
    medical_record_id UUID NOT NULL REFERENCES medical_records(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL,

    -- Prescription number for tracking (unique per clinic)
    prescription_number VARCHAR(50) NOT NULL,

    -- Visit date (date of consultation)
    visit_date DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Patient snapshot at time of prescription (for historical accuracy)
    patient_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Contains: firstName, lastName, birthDate, gender, address, phone, email, patientNumber

    -- Provider snapshot at time of prescription
    provider_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Contains: firstName, lastName, specialty, rpps, adeli, signature

    -- Vital signs at time of visit
    vital_signs JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Contains: weight, height, bmi, bloodPressure, heartRate, temperature

    -- Diagnosis information
    diagnosis JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Contains: primary, secondary[], icd10[]

    -- Treatments/medications prescribed
    treatments JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Array of: { medication, dosage, frequency, route, duration, quantity, instructions }

    -- Additional notes from doctor
    additional_notes TEXT,

    -- Validity period
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE,

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'printed', 'cancelled')),

    -- Finalization (signature)
    finalized_at TIMESTAMP,
    finalized_by UUID,

    -- Print tracking
    print_count INTEGER DEFAULT 0,
    last_printed_at TIMESTAMP,

    -- RGPD compliance - access log
    access_log JSONB DEFAULT '[]'::jsonb,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_prescriptions_medical_record ON prescriptions(medical_record_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_provider ON prescriptions(provider_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_number ON prescriptions(prescription_number);
CREATE INDEX IF NOT EXISTS idx_prescriptions_visit_date ON prescriptions(visit_date);
CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON prescriptions(status);

-- Unique constraint on prescription number (per clinic context)
CREATE UNIQUE INDEX IF NOT EXISTS idx_prescriptions_number_unique ON prescriptions(prescription_number);

-- Function to auto-generate prescription number
CREATE OR REPLACE FUNCTION generate_prescription_number()
RETURNS TRIGGER AS $$
DECLARE
    year_str VARCHAR(4);
    month_str VARCHAR(2);
    seq_num INTEGER;
    new_number VARCHAR(50);
BEGIN
    year_str := TO_CHAR(CURRENT_DATE, 'YYYY');
    month_str := TO_CHAR(CURRENT_DATE, 'MM');

    -- Get next sequence number for this month
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(prescription_number FROM 'ORD-\d{4}-\d{2}-(\d+)') AS INTEGER)
    ), 0) + 1
    INTO seq_num
    FROM prescriptions
    WHERE prescription_number LIKE 'ORD-' || year_str || '-' || month_str || '-%';

    new_number := 'ORD-' || year_str || '-' || month_str || '-' || LPAD(seq_num::TEXT, 4, '0');
    NEW.prescription_number := new_number;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-generating prescription number
DROP TRIGGER IF EXISTS trg_generate_prescription_number ON prescriptions;
CREATE TRIGGER trg_generate_prescription_number
    BEFORE INSERT ON prescriptions
    FOR EACH ROW
    WHEN (NEW.prescription_number IS NULL OR NEW.prescription_number = '')
    EXECUTE FUNCTION generate_prescription_number();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_prescription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updating timestamps
DROP TRIGGER IF EXISTS trg_update_prescription_timestamp ON prescriptions;
CREATE TRIGGER trg_update_prescription_timestamp
    BEFORE UPDATE ON prescriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_prescription_timestamp();

-- Comments for documentation
COMMENT ON TABLE prescriptions IS 'Medical prescriptions/ordonnances - traceable and printable';
COMMENT ON COLUMN prescriptions.prescription_number IS 'Unique prescription number format: ORD-YYYY-MM-NNNN';
COMMENT ON COLUMN prescriptions.patient_snapshot IS 'Patient data at time of prescription for historical accuracy';
COMMENT ON COLUMN prescriptions.provider_snapshot IS 'Provider/doctor data at time of prescription';
COMMENT ON COLUMN prescriptions.access_log IS 'RGPD compliance - log of all accesses to this prescription';

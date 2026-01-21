-- Migration: Create medical_records table
-- Purpose: Store medical records/consultations for patients
-- Date: 2024-12-09
-- Compliant: RGPD, Secret Médical (Art. L1110-4 CSP)

-- Medical Records Table
CREATE TABLE IF NOT EXISTS medical_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relationships
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES healthcare_providers(id) ON DELETE SET NULL,

    -- Record type
    record_type VARCHAR(50) NOT NULL DEFAULT 'consultation'
        CHECK (record_type IN ('consultation', 'examination', 'treatment', 'follow_up', 'emergency', 'prescription', 'lab_result', 'imaging', 'note')),

    -- Basic consultation info
    chief_complaint TEXT,
    symptoms JSONB DEFAULT '[]',
    duration VARCHAR(100),

    -- Vital signs
    vital_signs JSONB DEFAULT '{}',
    -- Structure: { weight, height, bmi, bloodPressure: {systolic, diastolic}, heartRate, temperature, respiratoryRate, oxygenSaturation }

    -- Medical history (antecedents)
    antecedents JSONB DEFAULT '{}',
    -- Structure: { personal: {medicalHistory, surgicalHistory, allergies, habits}, family: {...} }

    -- Allergies detailed
    allergies JSONB DEFAULT '[]',
    -- Structure: [{ allergen, type, severity, reaction, dateDiscovered }]

    -- Diagnosis
    diagnosis JSONB DEFAULT '{}',
    -- Structure: { primary, secondary: [], icd10: [] }

    -- Chronic conditions
    chronic_conditions JSONB DEFAULT '[]',
    -- Structure: [{ condition, diagnosisDate, practitioner, status, notes }]

    -- Physical examination
    physical_exam JSONB DEFAULT '{}',
    -- Structure: { general, cardiovascular, respiratory, abdomen, neurological, ... }

    -- Treatments/Medications
    treatments JSONB DEFAULT '[]',
    -- Structure: [{ medication, dosage, frequency, route, startDate, endDate, status, prescribedBy, notes }]

    -- Treatment plan
    treatment_plan JSONB DEFAULT '{}',
    -- Structure: { recommendations: [], followUp, tests: [] }

    -- Medication warnings (interactions)
    medication_warnings JSONB DEFAULT '[]',
    -- Structure: [{ type, severity, medications, warning, recommendation }]

    -- Blood type (can be stored at record level or patient level)
    blood_type VARCHAR(5) CHECK (blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') OR blood_type IS NULL),

    -- Notes
    notes TEXT,
    private_notes TEXT, -- Notes visibles uniquement par le praticien créateur

    -- Access control and audit (RGPD compliance)
    access_log JSONB DEFAULT '[]',
    -- Structure: [{ action, userId, timestamp, ipAddress, details }]

    -- Status
    is_signed BOOLEAN DEFAULT false,
    signed_at TIMESTAMP WITH TIME ZONE,
    signed_by UUID REFERENCES healthcare_providers(id),

    is_locked BOOLEAN DEFAULT false, -- Prevent modifications after signing

    -- Soft delete
    archived BOOLEAN DEFAULT false,
    archived_at TIMESTAMP WITH TIME ZONE,
    archived_by UUID REFERENCES healthcare_providers(id),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES healthcare_providers(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_medical_records_facility ON medical_records(facility_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_patient ON medical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_provider ON medical_records(provider_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_type ON medical_records(record_type);
CREATE INDEX IF NOT EXISTS idx_medical_records_created ON medical_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medical_records_archived ON medical_records(archived) WHERE archived = false;

-- Composite index for patient history queries
CREATE INDEX IF NOT EXISTS idx_medical_records_patient_date ON medical_records(patient_id, created_at DESC);

-- GIN index for JSONB search
CREATE INDEX IF NOT EXISTS idx_medical_records_diagnosis_gin ON medical_records USING GIN (diagnosis);
CREATE INDEX IF NOT EXISTS idx_medical_records_symptoms_gin ON medical_records USING GIN (symptoms);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_medical_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_medical_records_updated_at ON medical_records;
CREATE TRIGGER trigger_medical_records_updated_at
    BEFORE UPDATE ON medical_records
    FOR EACH ROW
    EXECUTE FUNCTION update_medical_records_updated_at();

-- Comments for documentation
COMMENT ON TABLE medical_records IS 'Dossiers médicaux des patients - Données protégées par le secret médical (Art. L1110-4 CSP)';
COMMENT ON COLUMN medical_records.access_log IS 'Journal d''accès RGPD - Traçabilité des consultations du dossier';
COMMENT ON COLUMN medical_records.private_notes IS 'Notes privées visibles uniquement par le praticien créateur';
COMMENT ON COLUMN medical_records.is_locked IS 'Verrouillage après signature - Empêche les modifications';

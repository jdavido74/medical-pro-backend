-- MedicalPro Database Schema
-- Adaptation of FacturePro schema for medical domain
-- Date: September 24, 2024

-- Medical Facilities (adapted from companies)
CREATE TABLE medical_facilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    facility_type VARCHAR(50) NOT NULL CHECK (facility_type IN ('cabinet', 'clinique', 'hopital', 'centre_sante', 'maison_medicale')),

    -- Registration and compliance
    finess VARCHAR(9), -- FINESS number for French medical facilities
    siret VARCHAR(14), -- SIRET for business registration
    adeli VARCHAR(11), -- ADELI for healthcare professionals
    rpps VARCHAR(11),  -- RPPS for healthcare professionals

    -- Contact information
    address_line1 VARCHAR(255) NOT NULL,
    address_line2 VARCHAR(255),
    postal_code VARCHAR(10) NOT NULL,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(2) NOT NULL DEFAULT 'FR',
    phone VARCHAR(20),
    email VARCHAR(255),
    website VARCHAR(255),

    -- Medical specialization
    specialties JSONB DEFAULT '[]'::jsonb, -- Medical specialties
    services JSONB DEFAULT '[]'::jsonb,    -- Services offered

    -- Configuration
    settings JSONB DEFAULT '{}'::jsonb,
    timezone VARCHAR(50) DEFAULT 'Europe/Paris',
    language VARCHAR(5) DEFAULT 'fr-FR',

    -- Status and metadata
    is_active BOOLEAN DEFAULT true,
    subscription_plan VARCHAR(50) DEFAULT 'basic',
    subscription_expires_at TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Healthcare Providers (adapted from users)
CREATE TABLE healthcare_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,

    -- Personal information
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    title VARCHAR(50), -- Dr, Prof, etc.

    -- Professional information
    profession VARCHAR(100) NOT NULL, -- médecin, infirmier, secrétaire, etc.
    specialties JSONB DEFAULT '[]'::jsonb,
    adeli VARCHAR(11),
    rpps VARCHAR(11),
    order_number VARCHAR(50), -- Numéro d'ordre professionnel

    -- Role and permissions
    role VARCHAR(50) NOT NULL DEFAULT 'practitioner' CHECK (role IN ('super_admin', 'admin', 'doctor', 'practitioner', 'specialist', 'nurse', 'secretary', 'readonly')),
    permissions JSONB DEFAULT '{}'::jsonb,

    -- Contact
    phone VARCHAR(20),
    mobile VARCHAR(20),

    -- Authentication
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Patients (adapted from clients)
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,

    -- Identity
    patient_number VARCHAR(50) UNIQUE, -- Auto-generated patient number
    social_security VARCHAR(15),       -- Numéro de sécurité sociale

    -- Personal information
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    maiden_name VARCHAR(100),
    birth_date DATE NOT NULL,
    gender VARCHAR(10) CHECK (gender IN ('M', 'F', 'other')),
    birth_place VARCHAR(255),
    nationality VARCHAR(50),

    -- Contact information
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    postal_code VARCHAR(10),
    city VARCHAR(100),
    country VARCHAR(2) DEFAULT 'FR',
    phone VARCHAR(20),
    mobile VARCHAR(20),
    email VARCHAR(255),

    -- Emergency contact
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    emergency_contact_relationship VARCHAR(100),

    -- Medical information
    blood_type VARCHAR(5),
    allergies TEXT,
    chronic_conditions TEXT,
    current_medications TEXT,

    -- Insurance and billing
    insurance_provider VARCHAR(255),
    insurance_number VARCHAR(50),
    mutual_insurance VARCHAR(255),
    mutual_number VARCHAR(50),

    -- Preferences
    preferred_language VARCHAR(5) DEFAULT 'fr',
    communication_preferences JSONB DEFAULT '{}'::jsonb,

    -- Consent and legal
    consent_data_processing BOOLEAN DEFAULT false,
    consent_marketing BOOLEAN DEFAULT false,
    legal_representative VARCHAR(255), -- For minors

    -- Status
    is_active BOOLEAN DEFAULT true,
    archived BOOLEAN DEFAULT false,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Appointments (adapted from quotes)
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES healthcare_providers(id) ON DELETE CASCADE,

    -- Appointment identification
    appointment_number VARCHAR(50) UNIQUE NOT NULL,

    -- Scheduling
    appointment_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,

    -- Appointment details
    type VARCHAR(50) NOT NULL, -- consultation, urgence, contrôle, etc.
    reason TEXT,
    notes TEXT,

    -- Status management
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),

    -- Reminders and notifications
    reminder_sent BOOLEAN DEFAULT false,
    reminder_sent_at TIMESTAMP,
    confirmation_required BOOLEAN DEFAULT true,
    confirmed_at TIMESTAMP,
    confirmed_by VARCHAR(50), -- patient, secretary, etc.

    -- Telehealth
    is_teleconsultation BOOLEAN DEFAULT false,
    meeting_link VARCHAR(255),

    -- Billing
    consultation_fee DECIMAL(10,2),
    insurance_covered BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(provider_id, appointment_date, start_time)
);

-- Medical Records (adapted from invoices)
CREATE TABLE medical_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES healthcare_providers(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id),

    -- Record identification
    record_number VARCHAR(50) UNIQUE NOT NULL,
    record_type VARCHAR(50) NOT NULL DEFAULT 'consultation'
        CHECK (record_type IN ('consultation', 'urgence', 'controle', 'certificat', 'ordonnance')),

    -- Consultation details
    consultation_date TIMESTAMP NOT NULL,
    chief_complaint TEXT, -- Motif de consultation
    history_present_illness TEXT, -- Histoire de la maladie actuelle

    -- Clinical examination
    physical_examination TEXT,
    vital_signs JSONB DEFAULT '{}'::jsonb, -- Tension, poids, température, etc.

    -- Assessment and plan
    diagnosis_primary VARCHAR(255),
    diagnosis_secondary TEXT,
    icd10_codes JSONB DEFAULT '[]'::jsonb, -- Codes CIM-10

    treatment_plan TEXT,
    prescriptions TEXT,
    recommendations TEXT,
    follow_up TEXT,

    -- Documents and attachments
    attachments JSONB DEFAULT '[]'::jsonb,

    -- Status and access
    status VARCHAR(50) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'completed', 'signed', 'archived')),
    signed_at TIMESTAMP,
    signed_by UUID REFERENCES healthcare_providers(id),

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Prescriptions (new medical-specific table)
CREATE TABLE prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES healthcare_providers(id) ON DELETE CASCADE,
    medical_record_id UUID REFERENCES medical_records(id),

    -- Prescription identification
    prescription_number VARCHAR(50) UNIQUE NOT NULL,

    -- Prescription details
    medications JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of medications with dosage, duration, etc.
    instructions TEXT,

    -- Validity
    prescribed_date DATE NOT NULL,
    valid_until DATE,
    renewable BOOLEAN DEFAULT false,
    renewals_remaining INTEGER DEFAULT 0,

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'dispensed', 'expired', 'cancelled')),

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Medical Documents (for PDF generation - certificates, prescriptions, etc.)
CREATE TABLE medical_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES healthcare_providers(id) ON DELETE CASCADE,

    -- Document details
    document_type VARCHAR(50) NOT NULL
        CHECK (document_type IN ('prescription', 'certificate', 'report', 'invoice', 'summary')),
    document_number VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT,

    -- References
    related_record_id UUID REFERENCES medical_records(id),
    related_appointment_id UUID REFERENCES appointments(id),
    related_prescription_id UUID REFERENCES prescriptions(id),

    -- File information
    file_path VARCHAR(500),
    file_size INTEGER,
    mime_type VARCHAR(100),

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'generated', 'sent', 'archived')),

    -- Timestamps
    generated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit Logs (preserved from FacturePro)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID REFERENCES medical_facilities(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES healthcare_providers(id) ON DELETE SET NULL,

    -- Action details
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,

    -- Data
    old_values JSONB,
    new_values JSONB,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Context
    ip_address INET,
    user_agent TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_medical_facilities_finess ON medical_facilities(finess);
CREATE INDEX idx_medical_facilities_active ON medical_facilities(is_active);
CREATE INDEX idx_healthcare_providers_facility ON healthcare_providers(facility_id);
CREATE INDEX idx_healthcare_providers_email ON healthcare_providers(email);
CREATE INDEX idx_patients_facility ON patients(facility_id);
CREATE INDEX idx_patients_patient_number ON patients(patient_number);
CREATE INDEX idx_patients_social_security ON patients(social_security);
CREATE INDEX idx_appointments_facility_date ON appointments(facility_id, appointment_date);
CREATE INDEX idx_appointments_provider_date ON appointments(provider_id, appointment_date);
CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_medical_records_facility ON medical_records(facility_id);
CREATE INDEX idx_medical_records_patient ON medical_records(patient_id);
CREATE INDEX idx_medical_records_date ON medical_records(consultation_date);
CREATE INDEX idx_prescriptions_facility ON prescriptions(facility_id);
CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX idx_audit_logs_facility ON audit_logs(facility_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- Create triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_medical_facilities_updated_at BEFORE UPDATE ON medical_facilities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_healthcare_providers_updated_at BEFORE UPDATE ON healthcare_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_medical_records_updated_at BEFORE UPDATE ON medical_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_prescriptions_updated_at BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_medical_documents_updated_at BEFORE UPDATE ON medical_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
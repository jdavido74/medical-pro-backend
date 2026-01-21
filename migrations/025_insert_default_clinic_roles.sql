-- Migration 025: Insert default system roles into clinic_roles
-- Date: 2026-01-19
-- Purpose: Populate clinic_roles table with default system roles for each facility
-- This ensures role management works properly in the admin interface

-- Function to insert default roles for a facility
CREATE OR REPLACE FUNCTION insert_default_clinic_roles(p_facility_id UUID)
RETURNS void AS $$
BEGIN
    -- Super Admin
    INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
    VALUES (
        p_facility_id,
        'super_admin',
        'Gestion technique de la plateforme - SANS accès aux données médicales',
        100,
        true,
        '["patients.view", "patients.create", "patients.edit", "patients.delete", "patients.export", "patients.view_all", "appointments.view", "appointments.create", "appointments.edit", "appointments.delete", "appointments.view_all", "appointments.view_practitioner", "consents.view", "consents.assign", "consent_templates.view", "consent_templates.create", "consent_templates.edit", "consent_templates.delete", "invoices.view", "invoices.create", "invoices.edit", "invoices.delete", "invoices.send", "quotes.view", "quotes.create", "quotes.edit", "quotes.delete", "analytics.view", "analytics.export", "analytics.admin", "users.view", "users.read", "users.create", "users.edit", "users.update", "users.delete", "users.permissions", "users.export", "roles.view", "roles.create", "roles.edit", "roles.delete", "teams.view", "teams.read", "teams.create", "teams.edit", "teams.update", "teams.delete", "teams.export", "delegations.view", "delegations.create", "delegations.edit", "delegations.approve", "delegations.revoke", "audit.view", "audit.export", "audit.manage", "system.settings", "system.backup", "system.audit", "settings.view", "settings.edit", "settings.clinic", "settings.security"]'::jsonb,
        'purple'
    ) ON CONFLICT (facility_id, name) DO NOTHING;

    -- Admin
    INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
    VALUES (
        p_facility_id,
        'admin',
        'Gestion de la clinique - SANS accès aux données médicales',
        90,
        true,
        '["patients.view", "patients.create", "patients.edit", "patients.delete", "patients.export", "patients.view_all", "appointments.view", "appointments.create", "appointments.edit", "appointments.delete", "appointments.view_all", "appointments.view_practitioner", "consents.view", "consents.assign", "consent_templates.view", "consent_templates.create", "consent_templates.edit", "consent_templates.delete", "invoices.view", "invoices.create", "invoices.edit", "invoices.delete", "invoices.send", "quotes.view", "quotes.create", "quotes.edit", "quotes.delete", "analytics.view", "analytics.export", "users.view", "users.read", "users.create", "users.edit", "users.update", "users.delete", "users.permissions", "users.export", "roles.view", "roles.create", "roles.edit", "roles.delete", "teams.view", "teams.read", "teams.create", "teams.edit", "teams.update", "teams.delete", "teams.export", "delegations.view", "delegations.create", "delegations.edit", "delegations.approve", "delegations.revoke", "audit.view", "audit.export", "settings.view", "settings.edit", "settings.clinic"]'::jsonb,
        'blue'
    ) ON CONFLICT (facility_id, name) DO NOTHING;

    -- Physician (Médecin)
    INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
    VALUES (
        p_facility_id,
        'physician',
        'Médecin (généraliste ou spécialiste) - Accès complet aux données médicales de ses patients',
        70,
        true,
        '["patients.view", "patients.create", "patients.edit", "appointments.view", "appointments.create", "appointments.edit", "appointments.delete", "medical_records.view", "medical_records.create", "medical_records.edit", "medical_notes.create", "medical.antecedents.view", "medical.antecedents.edit", "medical.prescriptions.view", "medical.prescriptions.create", "medical.allergies.view", "medical.allergies.edit", "medical.vitals.view", "medical.vitals.edit", "consents.view", "consents.create", "consents.edit", "consents.sign", "consents.revoke", "consent_templates.view", "quotes.view", "quotes.create", "quotes.edit", "analytics.view", "analytics.medical", "teams.view", "delegations.view", "delegations.create", "settings.view"]'::jsonb,
        'green'
    ) ON CONFLICT (facility_id, name) DO NOTHING;

    -- Practitioner (Praticien de santé)
    INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
    VALUES (
        p_facility_id,
        'practitioner',
        'Professionnel de santé (infirmier, kiné, etc.) - Accès limité aux données médicales nécessaires aux soins',
        50,
        true,
        '["patients.view", "patients.edit", "appointments.view", "appointments.create", "appointments.edit", "medical_records.view", "medical_notes.create", "medical.allergies.view", "medical.vitals.view", "medical.vitals.edit", "medical.prescriptions.view", "consents.view", "consent_templates.view", "settings.view"]'::jsonb,
        'teal'
    ) ON CONFLICT (facility_id, name) DO NOTHING;

    -- Secretary (Secrétaire médical)
    INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
    VALUES (
        p_facility_id,
        'secretary',
        'Gestion administrative - SANS accès aux données médicales',
        30,
        true,
        '["patients.view", "patients.create", "patients.edit", "patients.view_all", "appointments.view", "appointments.create", "appointments.edit", "appointments.delete", "appointments.view_all", "appointments.view_practitioner", "consents.view", "consents.assign", "consent_templates.view", "invoices.view", "invoices.create", "invoices.edit", "invoices.send", "quotes.view", "quotes.create", "quotes.edit", "settings.view"]'::jsonb,
        'orange'
    ) ON CONFLICT (facility_id, name) DO NOTHING;

    -- Readonly (Lecture seule)
    INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
    VALUES (
        p_facility_id,
        'readonly',
        'Accès consultation - Données administratives uniquement',
        10,
        true,
        '["patients.view", "appointments.view", "invoices.view", "quotes.view", "analytics.view", "settings.view"]'::jsonb,
        'gray'
    ) ON CONFLICT (facility_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Insert default roles for all existing facilities
DO $$
DECLARE
    facility_record RECORD;
BEGIN
    FOR facility_record IN SELECT id FROM medical_facilities
    LOOP
        PERFORM insert_default_clinic_roles(facility_record.id);
        RAISE NOTICE 'Inserted default roles for facility: %', facility_record.id;
    END LOOP;
END $$;

-- Add comments
COMMENT ON FUNCTION insert_default_clinic_roles IS 'Inserts default system roles for a facility. Should be called when creating a new facility.';

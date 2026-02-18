-- Migration clinic_061: Admin medical permissions + Nurse role
-- Date: 2026-02-18
-- Purpose:
--   1. Add medical permissions to admin role (read-only prescriptions, full access to records/antecedents/vitals/allergies)
--   2. Add nurse role (like physician but without prescription creation)

-- ============================================================================
-- 1. Update admin role: add medical permissions
-- ============================================================================
UPDATE clinic_roles
SET
    description = 'Gestion de la clinique - Accès complet incluant les données médicales (sans prescription)',
    permissions = (
        SELECT jsonb_agg(DISTINCT perm)
        FROM (
            -- Keep existing permissions
            SELECT jsonb_array_elements(permissions) AS perm
            FROM clinic_roles cr2
            WHERE cr2.id = clinic_roles.id
            UNION ALL
            -- Add new medical permissions
            SELECT p::jsonb
            FROM unnest(ARRAY[
                '"medical_records.view"',
                '"medical_records.create"',
                '"medical_records.edit"',
                '"medical_notes.create"',
                '"medical.antecedents.view"',
                '"medical.antecedents.edit"',
                '"medical.prescriptions.view"',
                '"medical.allergies.view"',
                '"medical.allergies.edit"',
                '"medical.vitals.view"',
                '"medical.vitals.edit"'
            ]) AS p
        ) AS combined
    )
WHERE name = 'admin' AND is_system_role = true;

-- ============================================================================
-- 2. Insert nurse role for all facilities
-- ============================================================================
INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
SELECT
    f.id,
    'nurse',
    'Infirmier(ère) - Accès complet aux données médicales sans prescription',
    45,
    true,
    '["patients.view", "patients.view_all", "patients.create", "patients.edit", "appointments.view", "appointments.create", "appointments.edit", "medical_records.view", "medical_records.create", "medical_records.edit", "medical_notes.create", "medical.antecedents.view", "medical.antecedents.edit", "medical.prescriptions.view", "medical.allergies.view", "medical.allergies.edit", "medical.vitals.view", "medical.vitals.edit", "consents.view", "consent_templates.view", "settings.view"]'::jsonb,
    'pink'
FROM medical_facilities f
WHERE NOT EXISTS (
    SELECT 1 FROM clinic_roles cr
    WHERE cr.facility_id = f.id AND cr.name = 'nurse'
);

-- ============================================================================
-- 3. Update the insert_default_clinic_roles function for new clinics
-- ============================================================================
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

    -- Admin (with medical permissions, no prescription create)
    INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
    VALUES (
        p_facility_id,
        'admin',
        'Gestion de la clinique - Accès complet incluant les données médicales (sans prescription)',
        90,
        true,
        '["patients.view", "patients.create", "patients.edit", "patients.delete", "patients.export", "patients.view_all", "appointments.view", "appointments.create", "appointments.edit", "appointments.delete", "appointments.view_all", "appointments.view_practitioner", "medical_records.view", "medical_records.create", "medical_records.edit", "medical_notes.create", "medical.antecedents.view", "medical.antecedents.edit", "medical.prescriptions.view", "medical.allergies.view", "medical.allergies.edit", "medical.vitals.view", "medical.vitals.edit", "consents.view", "consents.assign", "consent_templates.view", "consent_templates.create", "consent_templates.edit", "consent_templates.delete", "invoices.view", "invoices.create", "invoices.edit", "invoices.delete", "invoices.send", "quotes.view", "quotes.create", "quotes.edit", "quotes.delete", "analytics.view", "analytics.export", "users.view", "users.read", "users.create", "users.edit", "users.update", "users.delete", "users.permissions", "users.export", "roles.view", "roles.create", "roles.edit", "roles.delete", "teams.view", "teams.read", "teams.create", "teams.edit", "teams.update", "teams.delete", "teams.export", "delegations.view", "delegations.create", "delegations.edit", "delegations.approve", "delegations.revoke", "audit.view", "audit.export", "settings.view", "settings.edit", "settings.clinic"]'::jsonb,
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
        '["patients.view", "patients.view_all", "patients.create", "patients.edit", "appointments.view", "appointments.view_all", "appointments.create", "appointments.edit", "appointments.delete", "appointments.confirm", "medical_records.view", "medical_records.create", "medical_records.edit", "medical_notes.create", "medical.antecedents.view", "medical.antecedents.edit", "medical.prescriptions.view", "medical.prescriptions.create", "medical.allergies.view", "medical.allergies.edit", "medical.vitals.view", "medical.vitals.edit", "consents.view", "consents.create", "consents.edit", "consents.sign", "consents.revoke", "consent_templates.view", "quotes.view", "quotes.create", "quotes.edit", "analytics.view", "analytics.medical", "teams.view", "delegations.view", "delegations.create", "settings.view"]'::jsonb,
        'green'
    ) ON CONFLICT (facility_id, name) DO NOTHING;

    -- Practitioner (Praticien de santé)
    INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
    VALUES (
        p_facility_id,
        'practitioner',
        'Professionnel de santé (kiné, etc.) - Accès limité aux données médicales nécessaires aux soins',
        50,
        true,
        '["patients.view", "patients.edit", "appointments.view", "appointments.create", "appointments.edit", "medical_records.view", "medical_notes.create", "medical.allergies.view", "medical.vitals.view", "medical.vitals.edit", "medical.prescriptions.view", "consents.view", "consent_templates.view", "settings.view"]'::jsonb,
        'teal'
    ) ON CONFLICT (facility_id, name) DO NOTHING;

    -- Nurse (Infirmier/ère)
    INSERT INTO clinic_roles (facility_id, name, description, level, is_system_role, permissions, color)
    VALUES (
        p_facility_id,
        'nurse',
        'Infirmier(ère) - Accès complet aux données médicales sans prescription',
        45,
        true,
        '["patients.view", "patients.view_all", "patients.create", "patients.edit", "appointments.view", "appointments.create", "appointments.edit", "medical_records.view", "medical_records.create", "medical_records.edit", "medical_notes.create", "medical.antecedents.view", "medical.antecedents.edit", "medical.prescriptions.view", "medical.allergies.view", "medical.allergies.edit", "medical.vitals.view", "medical.vitals.edit", "consents.view", "consent_templates.view", "settings.view"]'::jsonb,
        'pink'
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

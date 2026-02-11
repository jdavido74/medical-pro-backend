-- clinic_057_physician_patients_view_all.sql
-- Add patients.view_all and missing permissions to physician role
-- Temporary measure until care team UI is built

-- Update physician permissions to include patients.view_all, appointments.view_all, appointments.confirm
UPDATE clinic_roles
SET permissions = (
  SELECT jsonb_agg(DISTINCT perm)
  FROM (
    -- Existing permissions
    SELECT jsonb_array_elements_text(permissions) AS perm
    FROM clinic_roles
    WHERE name = 'physician'
    UNION
    -- New permissions to add
    SELECT unnest(ARRAY[
      'patients.view_all',
      'appointments.view_all',
      'appointments.confirm'
    ])
  ) sub
)
WHERE name = 'physician';

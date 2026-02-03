-- Migration: Drop overly strict UNIQUE constraint on appointments
--
-- The UNIQUE(provider_id, appointment_date, start_time) constraint prevents
-- a provider from being assigned to two appointments at the same date/time,
-- even for treatments. Business rule: only consultation conflicts should block;
-- treatment conflicts are allowed (provider can supervise multiple treatments).
-- Application-level checks (checkProviderConflicts) already enforce this
-- distinction correctly.

ALTER TABLE appointments
DROP CONSTRAINT IF EXISTS appointments_provider_id_appointment_date_start_time_key;

-- Migration 013: Create clinic_settings table for centralized configuration
-- Date: 2025-12-07
-- Purpose: Store clinic-wide settings (operating hours, appointment slots, notifications)
-- Alternative to using medical_facilities.settings JSONB

CREATE TABLE IF NOT EXISTS clinic_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID UNIQUE NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,

    -- Operating hours by day of week
    operating_hours JSONB DEFAULT '{
      "monday": {"enabled": true, "start": "08:00", "end": "18:00"},
      "tuesday": {"enabled": true, "start": "08:00", "end": "18:00"},
      "wednesday": {"enabled": true, "start": "08:00", "end": "18:00"},
      "thursday": {"enabled": true, "start": "08:00", "end": "18:00"},
      "friday": {"enabled": true, "start": "08:00", "end": "17:00"},
      "saturday": {"enabled": false, "start": "09:00", "end": "13:00"},
      "sunday": {"enabled": false, "start": "09:00", "end": "13:00"}
    }'::jsonb,

    -- Appointment slot configuration
    slot_settings JSONB DEFAULT '{
      "defaultDuration": 30,
      "availableDurations": [15, 20, 30, 45, 60, 90, 120],
      "bufferTime": 5,
      "maxAdvanceBooking": 90,
      "minAdvanceBooking": 1,
      "allowWeekendBooking": false
    }'::jsonb,

    -- Exceptional closure dates
    closed_dates JSONB DEFAULT '[]'::jsonb,

    -- Appointment types configuration
    appointment_types JSONB DEFAULT '[
      {"id": "consultation", "name": "Consultation", "duration": 30, "color": "blue"},
      {"id": "follow_up", "name": "Suivi", "duration": 20, "color": "green"},
      {"id": "emergency", "name": "Urgence", "duration": 45, "color": "red"},
      {"id": "specialist", "name": "Spécialiste", "duration": 60, "color": "purple"},
      {"id": "exam", "name": "Examen", "duration": 45, "color": "orange"},
      {"id": "vaccination", "name": "Vaccination", "duration": 15, "color": "teal"}
    ]'::jsonb,

    -- Notification preferences
    notifications JSONB DEFAULT '{
      "patientReminders": {
        "enabled": true,
        "timeBefore": [24, 2],
        "methods": ["email", "sms"]
      },
      "practitionerReminders": {
        "enabled": true,
        "timeBefore": [30],
        "methods": ["email"]
      }
    }'::jsonb,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_clinic_settings_facility ON clinic_settings(facility_id);

-- Create trigger for updated_at
CREATE TRIGGER update_clinic_settings_updated_at
BEFORE UPDATE ON clinic_settings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE clinic_settings IS 'Centralized clinic configuration for operating hours, appointments, and notifications';
COMMENT ON COLUMN clinic_settings.operating_hours IS 'Weekly operating hours: {day: {enabled: boolean, start: "HH:MM", end: "HH:MM"}}';
COMMENT ON COLUMN clinic_settings.slot_settings IS 'Appointment slot configuration: duration, buffer time, booking limits';
COMMENT ON COLUMN clinic_settings.closed_dates IS 'Array of exceptional closure dates: [{date: "YYYY-MM-DD", reason: "...", type: "holiday|maintenance|other"}]';
COMMENT ON COLUMN clinic_settings.appointment_types IS 'Available appointment types with durations and colors';
COMMENT ON COLUMN clinic_settings.notifications IS 'Notification preferences for patients and practitioners';

-- Function to automatically create default settings when a new facility is created
CREATE OR REPLACE FUNCTION create_default_clinic_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO clinic_settings (facility_id)
    VALUES (NEW.id)
    ON CONFLICT (facility_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-create settings for new facilities
CREATE TRIGGER auto_create_clinic_settings
AFTER INSERT ON medical_facilities
FOR EACH ROW
EXECUTE FUNCTION create_default_clinic_settings();

-- Example structure for closed_dates:
-- [
--   {
--     "id": "uuid",
--     "date": "2025-12-25",
--     "reason": "Noël",
--     "type": "holiday"
--   },
--   {
--     "id": "uuid",
--     "date": "2025-08-15",
--     "reason": "Vacances",
--     "type": "other"
--   }
-- ]

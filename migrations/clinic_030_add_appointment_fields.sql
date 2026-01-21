-- Migration: Add missing columns to appointments table
-- Purpose: Align frontend form fields with database schema
-- Fields: priority, location, description, reminders (JSONB)

-- Add priority column (normal, high, urgent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'priority'
    ) THEN
        ALTER TABLE appointments ADD COLUMN priority VARCHAR(20) DEFAULT 'normal'
            CHECK (priority IN ('normal', 'high', 'urgent', 'low'));
        RAISE NOTICE 'Column priority added to appointments table';
    ELSE
        RAISE NOTICE 'Column priority already exists in appointments table';
    END IF;
END $$;

-- Add location column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'location'
    ) THEN
        ALTER TABLE appointments ADD COLUMN location VARCHAR(255);
        RAISE NOTICE 'Column location added to appointments table';
    ELSE
        RAISE NOTICE 'Column location already exists in appointments table';
    END IF;
END $$;

-- Add description column (separate from reason/title)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'description'
    ) THEN
        ALTER TABLE appointments ADD COLUMN description TEXT;
        RAISE NOTICE 'Column description added to appointments table';
    ELSE
        RAISE NOTICE 'Column description already exists in appointments table';
    END IF;
END $$;

-- Add reminders JSONB column for complex reminder configuration
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'reminders'
    ) THEN
        ALTER TABLE appointments ADD COLUMN reminders JSONB DEFAULT '{
            "patient": {"enabled": true, "beforeMinutes": 1440},
            "practitioner": {"enabled": true, "beforeMinutes": 30}
        }'::jsonb;
        RAISE NOTICE 'Column reminders added to appointments table';
    ELSE
        RAISE NOTICE 'Column reminders already exists in appointments table';
    END IF;
END $$;

-- Add title column (mapped from frontend, separate from reason)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'title'
    ) THEN
        ALTER TABLE appointments ADD COLUMN title VARCHAR(255);
        RAISE NOTICE 'Column title added to appointments table';

        -- Copy existing reason values to title for backward compatibility
        UPDATE appointments SET title = reason WHERE title IS NULL AND reason IS NOT NULL;
    ELSE
        RAISE NOTICE 'Column title already exists in appointments table';
    END IF;
END $$;

-- Create index on priority for filtering
CREATE INDEX IF NOT EXISTS idx_appointments_priority ON appointments(priority);

-- Add comments for documentation
COMMENT ON COLUMN appointments.priority IS 'Appointment priority: normal, high, urgent, low';
COMMENT ON COLUMN appointments.location IS 'Physical location of the appointment (room, office, etc.)';
COMMENT ON COLUMN appointments.description IS 'Detailed description of the appointment';
COMMENT ON COLUMN appointments.reminders IS 'Reminder configuration: { patient: { enabled, beforeMinutes }, practitioner: { enabled, beforeMinutes } }';
COMMENT ON COLUMN appointments.title IS 'Short title for the appointment';

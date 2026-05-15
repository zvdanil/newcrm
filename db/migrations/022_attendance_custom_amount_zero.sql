-- Migration 022: update attendance_logs custom_amount check
ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_custom_amount_check;
ALTER TABLE attendance_logs ADD CONSTRAINT attendance_logs_custom_amount_check CHECK (custom_amount IS NULL OR custom_amount >= 0);

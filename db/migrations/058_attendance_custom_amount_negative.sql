-- Migration 058: Drop attendance_logs_custom_amount_check constraint to allow negative custom_amount ("Спец компенсація")
ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_custom_amount_check;

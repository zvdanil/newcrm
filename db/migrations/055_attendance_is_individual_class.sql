-- Migration 055: Add is_individual_class to attendance_logs
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS is_individual_class BOOLEAN NOT NULL DEFAULT false;

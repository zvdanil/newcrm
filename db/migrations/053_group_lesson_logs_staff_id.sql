-- Migration 053: Group Lesson Logs Staff ID
-- Adds staff_id column to group_lesson_logs to support teacher-specific group lesson marks.

ALTER TABLE group_lesson_logs ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES staff(id) ON DELETE CASCADE;

ALTER TABLE group_lesson_logs DROP CONSTRAINT IF EXISTS group_lesson_logs_activity_id_date_key;

ALTER TABLE group_lesson_logs DROP CONSTRAINT IF EXISTS group_lesson_logs_activity_date_staff_key;

ALTER TABLE group_lesson_logs ADD CONSTRAINT group_lesson_logs_activity_date_staff_key UNIQUE NULLS NOT DISTINCT (activity_id, date, staff_id);

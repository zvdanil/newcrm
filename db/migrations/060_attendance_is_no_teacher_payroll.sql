-- Migration 060: Add is_no_teacher_payroll to attendance_logs
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS is_no_teacher_payroll BOOLEAN NOT NULL DEFAULT false;

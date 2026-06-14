-- Migration 047: add 'absent_excused_30' status to attendance_logs
ALTER TABLE attendance_logs DROP CONSTRAINT attendance_logs_status_check;
ALTER TABLE attendance_logs ADD CONSTRAINT attendance_logs_status_check
  CHECK (status IN ('present', 'absent_excused', 'absent_excused_30', 'absent_unexcused', 'special', 'separate_billing'));

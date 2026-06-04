-- Migration 041: add 'separate_billing' status to attendance_logs
-- ОР (Окремий розрахунок) — ребёнок присутствует, начисление ребёнку по тарифу,
-- начисление педагогу НЕ создаётся.
ALTER TABLE attendance_logs DROP CONSTRAINT attendance_logs_status_check;
ALTER TABLE attendance_logs ADD CONSTRAINT attendance_logs_status_check
  CHECK (status IN ('present', 'absent_excused', 'absent_unexcused', 'special', 'separate_billing'));

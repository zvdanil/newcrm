-- Migration 025: Smart Per Child rate type
-- Adds new fields to staff_smart_configs for attendance-based per-child calculation

ALTER TABLE staff_smart_configs
  ADD COLUMN IF NOT EXISTS attendance_threshold INT         NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS starter_rate         NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_lesson_price   NUMERIC(15,2) NOT NULL DEFAULT 0;

-- Comment: field usage by rate_type
-- rate_type = 'smart'           → uses: base_lessons, absence_threshold, threshold_rate (old logic, unchanged)
-- rate_type = 'smart_per_child' → uses: base_lessons, attendance_threshold, starter_rate, threshold_rate, extra_lesson_price

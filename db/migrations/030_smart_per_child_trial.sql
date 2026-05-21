-- Migration 030: Trial lesson price for smart_per_child rate
-- Adds trial_lesson_price to staff_smart_configs.
-- Logic: if child's trial marks (custom_amount IS NOT NULL) < attendance_threshold
--        → pay = trial_visits × trial_lesson_price
--        if trial marks >= attendance_threshold
--        → child converted to regular, pay = three-tier formula(all visits)

ALTER TABLE staff_smart_configs
  ADD COLUMN IF NOT EXISTS trial_lesson_price NUMERIC(15,2) NOT NULL DEFAULT 0;

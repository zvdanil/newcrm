-- 051_smart_tariff_min_attended.sql
-- Добавление параметра l1_min_attended_lessons для защиты от списания льготы в длинных месяцах

ALTER TABLE smart_tariff_configs
  ADD COLUMN IF NOT EXISTS l1_min_attended_lessons INT;

ALTER TABLE child_smart_tariff_configs
  ADD COLUMN IF NOT EXISTS l1_min_attended_lessons INT;

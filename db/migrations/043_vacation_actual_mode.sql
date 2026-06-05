-- Режим расчёта ставки отпуска: фиксированный оклад или по фактическим начислениям
ALTER TABLE staff_vacation_configs
  ADD COLUMN salary_calc_mode  VARCHAR(10) NOT NULL DEFAULT 'fixed',  -- 'fixed' | 'actual'
  ADD COLUMN included_rate_ids JSONB;                                  -- string[] rate_ids (только для 'actual')

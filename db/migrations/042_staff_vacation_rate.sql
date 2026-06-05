-- Конфигурация ставки типа "vacation" (Відпустка)
CREATE TABLE staff_vacation_configs (
  rate_id               UUID PRIMARY KEY REFERENCES staff_rates(id) ON DELETE CASCADE,
  monthly_base_salary   NUMERIC(15,2)  NOT NULL,
  vacation_days_limit   INTEGER        NOT NULL DEFAULT 24,
  period_start_date     DATE           NOT NULL,
  period_end_date       DATE           NOT NULL,
  calculation_base_type VARCHAR(20)    NOT NULL DEFAULT 'CALENDAR_DAYS', -- 'CALENDAR_DAYS' | 'WORKING_DAYS'
  day_rate_cached       NUMERIC(15,2)  NOT NULL,
  updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now()
);

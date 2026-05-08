-- 012: add value_mode to staff_rates
-- 'fixed'              — rate_value is absolute amount per unit
-- 'percent_of_revenue' — rate_value is % of child billing revenue for the activity

ALTER TABLE staff_rates
  ADD COLUMN value_mode VARCHAR(20) NOT NULL DEFAULT 'fixed'
    CHECK (value_mode IN ('fixed', 'percent_of_revenue'));

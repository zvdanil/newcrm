-- Migration 011: Personnel & Salary

CREATE TABLE staff (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      TEXT NOT NULL,
  specialization TEXT,
  type           VARCHAR(20) NOT NULL DEFAULT 'employee', -- 'employee' | 'partner'
  phone          TEXT,
  start_date     DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE staff_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  activity_id     UUID REFERENCES activities(id) ON DELETE SET NULL,
  rate_category   VARCHAR(20) NOT NULL DEFAULT 'auto', -- 'auto' | 'manual'
  rate_type       VARCHAR(30) NOT NULL,               -- 'per_lesson' | 'per_child' | 'fixed_monthly' | 'hourly' | 'smart' | 'bonus'
  rate_value      NUMERIC(15,2) NOT NULL DEFAULT 0,
  deduction_pct   NUMERIC(5,2)  NOT NULL DEFAULT 0,
  valid_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to        DATE,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON staff_rates (staff_id);
CREATE INDEX ON staff_rates (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX ON staff_rates (staff_id, activity_id) WHERE valid_to IS NULL;

CREATE TABLE staff_smart_configs (
  rate_id            UUID PRIMARY KEY REFERENCES staff_rates(id) ON DELETE CASCADE,
  base_lessons       INT            NOT NULL DEFAULT 8,
  absence_threshold  INT            NOT NULL,
  threshold_rate     NUMERIC(15,2)  NOT NULL,
  updated_at         TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE salary_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id         UUID NOT NULL REFERENCES staff(id),
  rate_id          UUID REFERENCES staff_rates(id) ON DELETE SET NULL,
  activity_id      UUID REFERENCES activities(id) ON DELETE SET NULL,
  type             VARCHAR(20) NOT NULL, -- 'ACCRUAL' | 'PAYMENT' | 'CORRECTION'
  gross_amount     NUMERIC(15,2) NOT NULL,
  deduction_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0,
  transaction_date DATE NOT NULL,
  billing_month    DATE,
  note             TEXT,
  edit_note        TEXT,
  metadata_json    JSONB,
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON salary_transactions (staff_id);
CREATE INDEX ON salary_transactions (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX ON salary_transactions (transaction_date);
CREATE INDEX ON salary_transactions (billing_month) WHERE billing_month IS NOT NULL;
CREATE INDEX ON salary_transactions (staff_id, billing_month);

-- Individual tariff overrides per child per activity (SCD Type 2)
-- Replaces child_prices for tariff-type-level customization.
CREATE TABLE child_individual_tariffs (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id    UUID          NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  activity_id UUID          NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  tariff_type VARCHAR(20)   NOT NULL CHECK (tariff_type IN ('monthly', 'per_lesson', 'smart')),
  price       NUMERIC(15,2) NOT NULL,
  valid_from  DATE          NOT NULL,
  valid_to    DATE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by  UUID          REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX ON child_individual_tariffs (child_id, activity_id);
CREATE INDEX ON child_individual_tariffs (valid_from);

-- Per-child smart tariff config (used when tariff_type = 'smart')
CREATE TABLE child_smart_tariff_configs (
  individual_tariff_id    UUID          PRIMARY KEY REFERENCES child_individual_tariffs(id) ON DELETE CASCADE,
  base_lessons            INTEGER       NOT NULL DEFAULT 0,
  l1_threshold_absences   INTEGER,
  l1_threshold_fee        NUMERIC(15,2),
  l2_max_refunds          INTEGER,
  l2_refund_per_absence   NUMERIC(15,2),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

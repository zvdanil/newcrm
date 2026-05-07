-- ============================================================
-- ЭТАП 2: Активности, Подписки, Счета
-- ============================================================

-- Финансовые счета (ФОП 1, ФОП 2, касса и т.д.)
CREATE TABLE accounts (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  type       VARCHAR(20)  NOT NULL CHECK (type IN ('fop', 'cash', 'bank')),
  currency   VARCHAR(10)  NOT NULL DEFAULT 'UAH',
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  note       TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Активности (садик, питание, английский и т.д.)
CREATE TABLE activities (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  account_id   UUID         REFERENCES accounts(id),
  tariff_type  VARCHAR(20)  NOT NULL DEFAULT 'monthly'
                 CHECK (tariff_type IN ('monthly', 'per_lesson')),
  is_rigid     BOOLEAN      NOT NULL DEFAULT false, -- жёсткий абонемент
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  note         TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Тарифы — SCD Type 2 (valid_to = NULL означает актуальный тариф)
CREATE TABLE tariffs (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID          NOT NULL REFERENCES activities(id),
  base_fee    NUMERIC(15,2) NOT NULL CHECK (base_fee >= 0),
  valid_from  DATE          NOT NULL,
  valid_to    DATE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Связанные активности (каскад отсутствия)
CREATE TABLE linked_activities (
  parent_activity_id UUID NOT NULL REFERENCES activities(id),
  child_activity_id  UUID NOT NULL REFERENCES activities(id),
  PRIMARY KEY (parent_activity_id, child_activity_id),
  CHECK (parent_activity_id <> child_activity_id)
);

-- Подписки детей на активности
CREATE TABLE enrollments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id    UUID        NOT NULL REFERENCES children(id),
  activity_id UUID        NOT NULL REFERENCES activities(id),
  account_id  UUID        NOT NULL REFERENCES accounts(id),
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'frozen', 'archived')),
  start_date  DATE        NOT NULL,
  end_date    DATE,
  frozen_from DATE,
  frozen_to   DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индивидуальный тариф / скидка ребёнка на активность — SCD Type 2
-- Либо price (абсолютная цена), либо discount_pct (скидка в %)
CREATE TABLE child_prices (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id     UUID          NOT NULL REFERENCES children(id),
  activity_id  UUID          NOT NULL REFERENCES activities(id),
  price        NUMERIC(15,2),
  discount_pct NUMERIC(5,2),
  valid_from   DATE          NOT NULL,
  valid_to     DATE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT child_prices_price_or_discount CHECK (
    (price IS NOT NULL AND discount_pct IS NULL) OR
    (price IS NULL AND discount_pct IS NOT NULL)
  )
);

-- Глобальная скидка ребёнка (на все активности) — SCD Type 2
CREATE TABLE child_global_discounts (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id     UUID          NOT NULL REFERENCES children(id),
  discount_pct NUMERIC(5,2)  NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
  valid_from   DATE          NOT NULL,
  valid_to     DATE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Индексы
CREATE INDEX ON activities(account_id);
CREATE INDEX ON tariffs(activity_id);
CREATE INDEX ON tariffs(activity_id, valid_from);
CREATE INDEX ON enrollments(child_id);
CREATE INDEX ON enrollments(activity_id);
CREATE INDEX ON enrollments(child_id, activity_id);
CREATE INDEX ON child_prices(child_id, activity_id);
CREATE INDEX ON child_global_discounts(child_id);

-- updated_at триггер для enrollments
CREATE TRIGGER set_enrollments_updated_at
  BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

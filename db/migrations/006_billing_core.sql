-- Migration 006: Billing Engine core tables
-- transactions     — иммутабельная финансовая история (физический DELETE запрещён)
-- child_balances   — денормализованный текущий баланс, обновляется после каждой транзакции
-- initial_balances — начальные остатки при вводе системы (не входят в PnL/оборот)
-- billing_run_log  — лог запусков Billing Run

-- ─── transactions ─────────────────────────────────────────────────────────────

CREATE TYPE transaction_type AS ENUM (
  'ACCRUAL',          -- начисление клиенту (ежемесячное или pro-rata)
  'PAYMENT',          -- оплата от клиента
  'REFUND',           -- возврат за пропуск (absent_excused)
  'REVERSAL',         -- сторно при soft-delete Owner-ом
  'ADJUSTMENT'        -- корректировка при ретро-пересчёте тарифа
);

CREATE TABLE transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             transaction_type NOT NULL,
  child_id         UUID NOT NULL REFERENCES children(id),
  account_id       UUID NOT NULL REFERENCES accounts(id),
  activity_id      UUID REFERENCES activities(id),
  enrollment_id    UUID REFERENCES enrollments(id),
  amount           NUMERIC(15,2) NOT NULL,         -- > 0 всегда; знак определяется типом
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  billing_month    DATE,                            -- первый день месяца (для ACCRUAL/ADJUSTMENT)
  note             TEXT,
  metadata_json    JSONB,                           -- слепок тарифа/скидки на момент создания
  -- Soft Delete (только Owner; физический DELETE запрещён)
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID REFERENCES users(id),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON transactions (child_id);
CREATE INDEX ON transactions (account_id);
CREATE INDEX ON transactions (enrollment_id);
CREATE INDEX ON transactions (transaction_date);
CREATE INDEX ON transactions (type);
CREATE INDEX ON transactions (billing_month) WHERE billing_month IS NOT NULL;
-- Составной для поиска дублей при Billing Run
CREATE UNIQUE INDEX transactions_accrual_unique
  ON transactions (enrollment_id, billing_month)
  WHERE type = 'ACCRUAL' AND is_deleted = false AND billing_month IS NOT NULL;

-- ─── child_balances ────────────────────────────────────────────────────────────
-- Денормализованный баланс: > 0 = аванс, < 0 = долг.
-- Формула: SUM(PAYMENT) + SUM(REFUND) - SUM(ACCRUAL) + SUM(начальных остатков)
-- Обновляется сервисом после каждой транзакции.

CREATE TABLE child_balances (
  child_id    UUID NOT NULL REFERENCES children(id),
  account_id  UUID NOT NULL REFERENCES accounts(id),
  balance     NUMERIC(15,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, account_id)
);

-- ─── initial_balances ─────────────────────────────────────────────────────────
-- Начальные остатки при вводе системы в эксплуатацию.
-- Учитываются в child_balances, но НЕ создают транзакций — не входят в PnL.

CREATE TABLE initial_balances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id    UUID NOT NULL REFERENCES children(id),
  account_id  UUID NOT NULL REFERENCES accounts(id),
  amount      NUMERIC(15,2) NOT NULL,  -- > 0 = аванс, < 0 = долг
  note        TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, account_id)        -- один начальный остаток на пару child+account
);

-- ─── billing_run_log ──────────────────────────────────────────────────────────

CREATE TABLE billing_run_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_month   DATE NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  created_count   INTEGER NOT NULL DEFAULT 0,   -- новых ACCRUAL
  adjusted_count  INTEGER NOT NULL DEFAULT 0,   -- ADJUSTMENT (тариф изменился)
  skipped_count   INTEGER NOT NULL DEFAULT 0,   -- уже актуальных (пропущено)
  triggered_by    UUID REFERENCES users(id),    -- NULL = cron
  error           TEXT                          -- если запуск завершился ошибкой
);

CREATE INDEX ON billing_run_log (billing_month);

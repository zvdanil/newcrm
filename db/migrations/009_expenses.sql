-- Migration 009: Expenses Journal + Account Transfers
-- expense_categories  — двухуровневая иерархия категорий расходов
-- expenses            — журнал расходов (pending / paid, is_dividend)
-- account_transfers   — переводы между счетами

-- ─── expense_categories ───────────────────────────────────────────────────────

CREATE TABLE expense_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  parent_id  UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Базовые категории
INSERT INTO expense_categories (name, sort_order) VALUES
  ('Оренда',          10),
  ('Комунальні',      20),
  ('Господарчі',      30),
  ('Маркетинг',       40),
  ('Зарплата',        50),
  ('Вивід коштів',    60),
  ('Інше',            99);

-- ─── expenses ─────────────────────────────────────────────────────────────────

CREATE TYPE expense_status AS ENUM ('pending', 'paid');

CREATE TABLE expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id),
  category_id   UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  amount        NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  accrual_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_date  DATE,
  status        expense_status NOT NULL DEFAULT 'pending',
  is_instant    BOOLEAN NOT NULL DEFAULT false,   -- нараховано і оплачено одночасно
  is_dividend   BOOLEAN NOT NULL DEFAULT false,   -- вивід коштів / дивіденд
  note          TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  is_deleted    BOOLEAN NOT NULL DEFAULT false,
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON expenses (account_id);
CREATE INDEX ON expenses (category_id);
CREATE INDEX ON expenses (accrual_date);
CREATE INDEX ON expenses (status) WHERE is_deleted = false;
CREATE INDEX ON expenses (is_dividend) WHERE is_deleted = false;

-- ─── account_transfers ────────────────────────────────────────────────────────

CREATE TABLE account_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id UUID NOT NULL REFERENCES accounts(id),
  to_account_id   UUID NOT NULL REFERENCES accounts(id),
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  commission      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  transfer_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  note            TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT different_accounts CHECK (from_account_id <> to_account_id)
);

CREATE INDEX ON account_transfers (from_account_id);
CREATE INDEX ON account_transfers (to_account_id);
CREATE INDEX ON account_transfers (transfer_date);

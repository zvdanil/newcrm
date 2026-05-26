-- Arbitrary incoming payments not linked to a child
CREATE TABLE account_income (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID         NOT NULL REFERENCES accounts(id),
  income_date    DATE         NOT NULL,
  amount         NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payer_name     TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by     UUID         REFERENCES users(id),
  is_deleted     BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID         REFERENCES users(id)
);

CREATE INDEX ON account_income (account_id);
CREATE INDEX ON account_income (income_date);

-- Technical balance corrections (signed amount: positive = increase, negative = decrease)
CREATE TABLE account_corrections (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID         NOT NULL REFERENCES accounts(id),
  correction_date DATE         NOT NULL,
  amount          NUMERIC(15,2) NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by      UUID         REFERENCES users(id),
  is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID         REFERENCES users(id)
);

CREATE INDEX ON account_corrections (account_id);
CREATE INDEX ON account_corrections (correction_date);

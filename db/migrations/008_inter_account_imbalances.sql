-- ============================================================
-- ЭТАП 8: Межсчётный дисбаланс (кросс-счётные оплаты)
-- ============================================================

-- Таблица межсчётных дисбалансов:
-- Возникает когда деньги физически поступают на один счёт (from_account),
-- но долг закрывается по другому счёту (to_account).
-- Owner/Admin видят незакрытые дисбалансы в карточке счёта.
CREATE TABLE inter_account_imbalances (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id  UUID          NOT NULL REFERENCES accounts(id),
  to_account_id    UUID          NOT NULL REFERENCES accounts(id),
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  transaction_id   UUID          REFERENCES transactions(id) ON DELETE SET NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID          REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX ON inter_account_imbalances (from_account_id);
CREATE INDEX ON inter_account_imbalances (to_account_id);
CREATE INDEX ON inter_account_imbalances (resolved_at);

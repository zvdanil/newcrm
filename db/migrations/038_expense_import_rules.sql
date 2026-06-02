CREATE TABLE expense_import_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  edrpou           TEXT,
  iban             TEXT,
  keyword_pattern  TEXT,
  category_id      UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  is_skip          BOOLEAN NOT NULL DEFAULT false,
  match_count      INTEGER NOT NULL DEFAULT 0,
  last_matched_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON expense_import_rules (account_id);
CREATE INDEX ON expense_import_rules (edrpou) WHERE edrpou IS NOT NULL;
CREATE INDEX ON expense_import_rules (iban) WHERE iban IS NOT NULL;

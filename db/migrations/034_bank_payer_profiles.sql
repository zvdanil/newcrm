CREATE TABLE bank_payer_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id          UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  counterparty_name TEXT NOT NULL,
  inn               TEXT,
  iban              TEXT,
  import_count      INTEGER NOT NULL DEFAULT 1,
  last_import_date  DATE    NOT NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX bank_payer_profiles_child_inn_uidx
  ON bank_payer_profiles (child_id, inn) WHERE inn IS NOT NULL;

CREATE UNIQUE INDEX bank_payer_profiles_child_iban_uidx
  ON bank_payer_profiles (child_id, iban) WHERE iban IS NOT NULL AND inn IS NULL;

CREATE INDEX bank_payer_profiles_inn_idx  ON bank_payer_profiles (inn)  WHERE inn  IS NOT NULL;
CREATE INDEX bank_payer_profiles_iban_idx ON bank_payer_profiles (iban) WHERE iban IS NOT NULL;

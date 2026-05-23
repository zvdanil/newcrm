CREATE TABLE import_templates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  description          TEXT,
  header_row_index     SMALLINT NOT NULL DEFAULT 1,
  data_start_row_index SMALLINT NOT NULL DEFAULT 2,
  col_date             TEXT NOT NULL,
  col_amount           TEXT NOT NULL,
  col_type             TEXT,
  col_type_credit_value TEXT,
  col_counterparty     TEXT,
  col_inn              TEXT,
  col_iban             TEXT,
  col_description      TEXT,
  amount_negate        BOOLEAN NOT NULL DEFAULT false,
  created_by           UUID,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

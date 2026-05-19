-- Migration 026: Expense edit audit log

CREATE TABLE expense_edits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  edited_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  edited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  field_name  TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  edit_note   TEXT
);

CREATE INDEX ON expense_edits (expense_id);
CREATE INDEX ON expense_edits (edited_at DESC);

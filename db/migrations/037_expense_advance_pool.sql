-- Pool-based advance usage: one expense can consume multiple advances (FIFO)
CREATE TABLE expense_advance_usages (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID         NOT NULL REFERENCES expenses(id),
  advance_id  UUID         NOT NULL REFERENCES expenses(id),
  amount      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(expense_id, advance_id)
);
CREATE INDEX ON expense_advance_usages(advance_id);
CREATE INDEX ON expense_advance_usages(expense_id);

-- Which staff member's pool was debited (set when using pool-based deduction)
ALTER TABLE expenses ADD COLUMN advance_staff_id UUID REFERENCES staff(id);
CREATE INDEX ON expenses(advance_staff_id);

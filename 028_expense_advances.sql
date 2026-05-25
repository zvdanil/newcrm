-- Migration 028: Expense advances and accountability

ALTER TABLE expenses
  ADD COLUMN staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN is_advance BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_advance_return BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN utilized_advance_id UUID REFERENCES expenses(id) ON DELETE RESTRICT,
  ADD COLUMN utilized_advance_amount NUMERIC(15,2);

CREATE INDEX idx_expenses_staff_id ON expenses(staff_id);
CREATE INDEX idx_expenses_utilized_advance ON expenses(utilized_advance_id);
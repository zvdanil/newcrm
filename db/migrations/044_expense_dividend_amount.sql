-- Migration 044: Partial dividend amount for expenses
-- Allows marking only a portion of an expense as dividend (analogous to withdrawal_amount for obnal).
-- NULL means the full expense.amount is treated as dividend.

ALTER TABLE expenses
  ADD COLUMN dividend_amount NUMERIC(15,2) NULL;

COMMENT ON COLUMN expenses.dividend_amount IS 'Partial dividend amount; NULL means full expense.amount is the dividend';

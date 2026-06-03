-- Partial cash-out amount (may be less than expense.amount)
ALTER TABLE expenses
  ADD COLUMN withdrawal_amount NUMERIC(15,2) NULL;

COMMENT ON COLUMN expenses.withdrawal_amount IS 'Sum transferred to target account on obnal; NULL until withdrawn';

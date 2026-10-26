ALTER TABLE account_transfers
  ADD COLUMN IF NOT EXISTS commission_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_account_transfers_commission_expense_id
  ON account_transfers (commission_expense_id)
  WHERE commission_expense_id IS NOT NULL;

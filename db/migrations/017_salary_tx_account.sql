-- Add account_id to salary_transactions to track which account salary was paid from
ALTER TABLE salary_transactions
  ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX ON salary_transactions (account_id) WHERE account_id IS NOT NULL;

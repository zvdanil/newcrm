-- Migration 020: Salary payments — dividend flag and withdrawal linkage
-- Mirrors the is_dividend / withdrawal_transfer_id pattern from expenses table.

ALTER TABLE salary_transactions
  ADD COLUMN is_dividend            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN withdrawal_transfer_id UUID REFERENCES account_transfers(id) ON DELETE SET NULL;

CREATE INDEX ON salary_transactions (withdrawal_transfer_id)
  WHERE withdrawal_transfer_id IS NOT NULL;

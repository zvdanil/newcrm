-- Migration 010: Expense withdrawal linkage
-- Adds withdrawal_transfer_id to expenses so a "cash-out" operation
-- can be recorded once and linked back to the source expense.

ALTER TABLE expenses
  ADD COLUMN withdrawal_transfer_id UUID REFERENCES account_transfers(id) ON DELETE SET NULL;

CREATE INDEX ON expenses (withdrawal_transfer_id) WHERE withdrawal_transfer_id IS NOT NULL;

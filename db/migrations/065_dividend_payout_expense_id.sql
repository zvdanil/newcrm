ALTER TABLE dividend_payouts
  ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS salary_tx_id UUID REFERENCES salary_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dividend_payouts_expense_id ON dividend_payouts (expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dividend_payouts_salary_tx_id ON dividend_payouts (salary_tx_id) WHERE salary_tx_id IS NOT NULL;

UPDATE dividend_payouts dp
SET expense_id = e.id
FROM expenses e
WHERE e.dividend_payout_id = dp.id AND dp.expense_id IS NULL;

UPDATE dividend_payouts dp
SET salary_tx_id = st.id
FROM salary_transactions st
WHERE st.dividend_payout_id = dp.id AND dp.salary_tx_id IS NULL;

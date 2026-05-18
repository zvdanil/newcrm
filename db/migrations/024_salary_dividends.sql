-- Add dividend_payout_id to salary_transactions
ALTER TABLE salary_transactions
ADD COLUMN dividend_payout_id UUID REFERENCES dividend_payouts(id) ON DELETE SET NULL;

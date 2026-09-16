-- Add balance_date to initial_balances to allow setting and editing user dates for initial balances
ALTER TABLE initial_balances ADD COLUMN IF NOT EXISTS balance_date DATE DEFAULT CURRENT_DATE;

-- Populate existing initial balances with their created_at date if empty
UPDATE initial_balances SET balance_date = created_at::date WHERE balance_date IS NULL;

-- Set NOT NULL constraint
ALTER TABLE initial_balances ALTER COLUMN balance_date SET NOT NULL;

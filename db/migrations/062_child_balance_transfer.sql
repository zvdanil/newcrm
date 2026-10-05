-- 062_child_balance_transfer.sql
-- Add TRANSFER_IN and TRANSFER_OUT to transaction_type enum and update recalc_child_balance function

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';

CREATE OR REPLACE FUNCTION recalc_child_balance(p_child_id UUID, p_account_id UUID)
RETURNS VOID AS $$
DECLARE
  v_balance NUMERIC(12, 2) := 0;
  v_tx_sum NUMERIC(12, 2) := 0;
  v_init_sum NUMERIC(12, 2) := 0;
BEGIN
  IF p_child_id IS NULL OR p_account_id IS NULL THEN
    RETURN;
  END IF;

  -- Calculate transaction total
  SELECT COALESCE(SUM(
    CASE 
      WHEN type IN ('PAYMENT', 'REFUND', 'REVERSAL', 'TRANSFER_IN') THEN amount
      WHEN type IN ('ACCRUAL', 'ADJUSTMENT', 'TRANSFER_OUT') THEN -amount
      ELSE 0
    END
  ), 0)
  INTO v_tx_sum
  FROM transactions
  WHERE child_id = p_child_id
    AND account_id = p_account_id
    AND is_deleted = false;

  -- Calculate initial balance total
  SELECT COALESCE(SUM(amount), 0)
  INTO v_init_sum
  FROM initial_balances
  WHERE child_id = p_child_id
    AND account_id = p_account_id;

  v_balance := v_tx_sum + v_init_sum;

  -- Upsert child_balances
  INSERT INTO child_balances (child_id, account_id, balance, updated_at)
  VALUES (p_child_id, p_account_id, v_balance, CURRENT_TIMESTAMP)
  ON CONFLICT (child_id, account_id)
  DO UPDATE SET balance = EXCLUDED.balance, updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

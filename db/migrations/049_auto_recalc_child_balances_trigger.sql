-- 049_auto_recalc_child_balances_trigger.sql
-- Function to recalculate balance for a specific child + account pair
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
      WHEN type IN ('PAYMENT', 'REFUND', 'REVERSAL') THEN amount
      WHEN type IN ('ACCRUAL', 'ADJUSTMENT') THEN -amount
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

-- Trigger function for transactions table
CREATE OR REPLACE FUNCTION trg_recalc_child_balance_from_tx()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM recalc_child_balance(OLD.child_id, OLD.account_id);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM recalc_child_balance(NEW.child_id, NEW.account_id);
    IF (OLD.child_id IS DISTINCT FROM NEW.child_id OR OLD.account_id IS DISTINCT FROM NEW.account_id) THEN
      PERFORM recalc_child_balance(OLD.child_id, OLD.account_id);
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    PERFORM recalc_child_balance(NEW.child_id, NEW.account_id);
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_recalc_child_balance ON transactions;

CREATE TRIGGER trg_transactions_recalc_child_balance
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW
EXECUTE FUNCTION trg_recalc_child_balance_from_tx();

-- Trigger function for initial_balances table
CREATE OR REPLACE FUNCTION trg_recalc_child_balance_from_init()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM recalc_child_balance(OLD.child_id, OLD.account_id);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM recalc_child_balance(NEW.child_id, NEW.account_id);
    IF (OLD.child_id IS DISTINCT FROM NEW.child_id OR OLD.account_id IS DISTINCT FROM NEW.account_id) THEN
      PERFORM recalc_child_balance(OLD.child_id, OLD.account_id);
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    PERFORM recalc_child_balance(NEW.child_id, NEW.account_id);
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_initial_balances_recalc_child_balance ON initial_balances;

CREATE TRIGGER trg_initial_balances_recalc_child_balance
AFTER INSERT OR UPDATE OR DELETE ON initial_balances
FOR EACH ROW
EXECUTE FUNCTION trg_recalc_child_balance_from_init();

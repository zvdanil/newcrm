-- Fix balance_date for initial balances that were mistakenly set to 2026-09-16 by migration 059
UPDATE initial_balances
SET balance_date = created_at::date
WHERE balance_date = '2026-09-16' AND created_at::date != '2026-09-16';

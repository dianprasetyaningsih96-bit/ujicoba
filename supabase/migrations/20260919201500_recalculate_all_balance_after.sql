-- =====================================================================
-- RECALCULATE ALL BALANCE_AFTER
-- =====================================================================
WITH running AS (
  SELECT id, SUM(amount) OVER (PARTITION BY branch_id, currency_id ORDER BY created_at ASC, id ASC) as calc_balance
  FROM public.cash_movements
) 
UPDATE public.cash_movements cm 
SET balance_after = running.calc_balance 
FROM running 
WHERE cm.id = running.id;

-- =====================================================================
-- Migration: Fix IDR total amounts and cash balances for multi-currency transactions
-- =====================================================================

DO $$
DECLARE
  v_rec RECORD;
  v_diff NUMERIC;
  v_idr_id UUID;
  v_branch_id UUID := 'a33c8202-803b-41a8-a8f9-c46d2f350dde'::UUID; -- Jimbaran (HQ)
BEGIN
  SELECT id INTO v_idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  -- 1. Correct transactions.idr_amount based on sum of transaction_items
  UPDATE public.transactions t
  SET idr_amount = sub.items_total,
      updated_at = now()
  FROM (
    SELECT transaction_id, SUM(idr_amount) as items_total
    FROM public.transaction_items
    GROUP BY transaction_id
  ) sub
  WHERE t.id = sub.transaction_id
    AND ABS(t.idr_amount - sub.items_total) > 0.01;

  -- 2. Update the IDR cash movement for AMVJ2-20260903-001 (33.559.000)
  UPDATE public.cash_movements
  SET amount = 33559000.00
  WHERE id = 'b80cffb3-58a9-48c9-9a15-979a5aef161d';

  -- 3. Update the IDR cash movement for AMVJ2-20260904-001 (33.706.000)
  UPDATE public.cash_movements
  SET amount = 33706000.00
  WHERE id = 'f9105ddc-3f78-4b1d-87d0-972559fbe325';

  -- 4. Update the IDR cash movement for AMVJ2-20260906-001 (30.598.750)
  UPDATE public.cash_movements
  SET amount = 30598750.00
  WHERE id = 'dcc31d79-5d02-448e-bd79-8db11531d1ca';

  -- 5. Adjust Jimbaran IDR cash balance by +71.364.250
  -- (28.261.000 + 21.372.000 + 21.731.250)
  UPDATE public.cash_balances
  SET balance = balance + 71364250.00,
      updated_at = now()
  WHERE branch_id = v_branch_id
    AND currency_id = v_idr_id;

  -- 6. Recalculate balance_after for cash_movements in Jimbaran for IDR
  WITH running AS (
    SELECT id, SUM(amount) OVER (
      PARTITION BY branch_id, currency_id 
      ORDER BY created_at ASC, id ASC
    ) as calc_balance
    FROM public.cash_movements
    WHERE branch_id = v_branch_id
      AND currency_id = v_idr_id
  )
  UPDATE public.cash_movements cm
  SET balance_after = running.calc_balance
  FROM running
  WHERE cm.id = running.id;

END $$;

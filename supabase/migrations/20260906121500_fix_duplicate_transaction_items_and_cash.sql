-- =====================================================================
-- Fix duplicate rows in transaction_items and duplicate cash movements
-- =====================================================================

DO $$
DECLARE
  v_dup RECORD;
BEGIN
  -- 1. Deduplicate cash_movements & adjust cash_balances
  FOR v_dup IN
    WITH ranked AS (
      SELECT cm.id, cm.branch_id, cm.currency_id, cm.amount,
             ROW_NUMBER() OVER (PARTITION BY cm.reference_no, cm.currency_id ORDER BY cm.id) as rn
      FROM public.cash_movements cm
      WHERE cm.notes = 'Auto dari transaksi'
    )
    SELECT branch_id, currency_id, sum(amount) as total_amount, array_agg(id) as ids
    FROM ranked
    WHERE rn > 1
    GROUP BY branch_id, currency_id
  LOOP
    -- Revert excess balance
    UPDATE public.cash_balances
    SET balance = balance - v_dup.total_amount
    WHERE branch_id = v_dup.branch_id AND currency_id = v_dup.currency_id;

    -- Delete duplicate cash movements
    DELETE FROM public.cash_movements
    WHERE id = ANY(v_dup.ids);
  END LOOP;

  -- 2. Deduplicate transaction_items (keep only 1 row per transaction item)
  DELETE FROM public.transaction_items
  WHERE id IN (
    WITH ranked_items AS (
      SELECT ti.id,
             ROW_NUMBER() OVER (PARTITION BY ti.transaction_id, ti.currency_id, ti.foreign_amount, ti.rate ORDER BY ti.id) as rn
      FROM public.transaction_items ti
    )
    SELECT id FROM ranked_items WHERE rn > 1
  );
END $$;

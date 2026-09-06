-- =====================================================================
-- Migration: Fix null branch transactions, backfill missing cash movements,
-- and ensure create_multi_currency_transaction resolves Head Office branch
-- =====================================================================

DO $$
DECLARE
  v_hq_id uuid;
  v_idr_id uuid;
  t record;
  ti record;
BEGIN
  -- 1. Find Head Office branch
  SELECT id INTO v_hq_id FROM public.branches WHERE is_head_office = true LIMIT 1;
  IF v_hq_id IS NULL THEN
    SELECT id INTO v_hq_id FROM public.branches ORDER BY created_at ASC LIMIT 1;
  END IF;

  SELECT id INTO v_idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  IF v_hq_id IS NOT NULL THEN
    -- 2. Link any orphan transactions without branch_id to Head Office
    UPDATE public.transactions
    SET branch_id = v_hq_id
    WHERE branch_id IS NULL;

    -- 3. Post cash movements for transactions that don't have them
    FOR t IN 
      SELECT * FROM public.transactions 
      WHERE branch_id = v_hq_id 
        AND status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM public.cash_movements cm WHERE cm.reference_id = transactions.id
        )
    LOOP
      -- Insert IDR cash movement
      IF v_idr_id IS NOT NULL THEN
        INSERT INTO public.cash_movements (
          branch_id, currency_id, movement_type, amount,
          reference_id, reference_no, notes, created_by, created_at
        ) VALUES (
          v_hq_id, v_idr_id,
          t.transaction_type::text::public.cash_movement_type,
          CASE WHEN t.transaction_type = 'buy' THEN -t.idr_amount ELSE t.idr_amount END,
          t.id, t.transaction_no,
          'Auto dari transaksi (IDR)', t.teller_id, t.transaction_date
        );
      END IF;

      -- Insert foreign currency cash movement for each item
      FOR ti IN SELECT * FROM public.transaction_items WHERE transaction_id = t.id LOOP
        INSERT INTO public.cash_movements (
          branch_id, currency_id, movement_type, amount,
          reference_id, reference_no, notes, created_by, created_at
        ) VALUES (
          v_hq_id, ti.currency_id,
          t.transaction_type::text::public.cash_movement_type,
          CASE WHEN t.transaction_type = 'buy' THEN ti.foreign_amount ELSE -ti.foreign_amount END,
          t.id, t.transaction_no,
          'Auto dari transaksi', t.teller_id, t.transaction_date
        );
      END LOOP;
    END LOOP;

    -- 4. Recalculate balance_after for cash_movements in Head Office
    WITH running AS (
      SELECT id, SUM(amount) OVER (
        PARTITION BY branch_id, currency_id 
        ORDER BY created_at ASC, id ASC
      ) as calc_balance
      FROM public.cash_movements
      WHERE branch_id = v_hq_id
    )
    UPDATE public.cash_movements cm
    SET balance_after = running.calc_balance
    FROM running
    WHERE cm.id = running.id;
  END IF;
END $$;

-- 5. Ensure create_multi_currency_transaction always defaults null branch to Head Office
CREATE OR REPLACE FUNCTION public.create_multi_currency_transaction(
  p_branch_id uuid,
  p_customer_id uuid,
  p_transaction_type text,
  p_payment_method text,
  p_notes text,
  p_transaction_date timestamptz,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx record;
  v_item record;
  v_total_idr numeric := 0;
  v_first_curr uuid;
  v_first_foreign numeric;
  v_first_rate numeric;
  v_curr_balance numeric;
  v_res jsonb;
  v_type public.transaction_type;
  v_pay public.payment_method;
  v_effective_branch_id uuid := p_branch_id;
BEGIN
  v_type := p_transaction_type::public.transaction_type;
  v_pay := COALESCE(p_payment_method, 'cash')::public.payment_method;

  -- Verify permission
  IF NOT (
    has_role(auth.uid(), 'teller') OR 
    has_role(auth.uid(), 'super_admin') OR 
    has_role(auth.uid(), 'branch_manager') OR 
    has_role(auth.uid(), 'owner')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak. Tidak memiliki izin untuk membuat transaksi.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Minimal harus ada 1 mata uang dalam transaksi.';
  END IF;

  -- Default null branch to Head Office
  IF v_effective_branch_id IS NULL THEN
    SELECT id INTO v_effective_branch_id FROM public.branches WHERE is_head_office = true LIMIT 1;
    IF v_effective_branch_id IS NULL THEN
      SELECT id INTO v_effective_branch_id FROM public.branches ORDER BY created_at ASC LIMIT 1;
    END IF;
  END IF;

  -- Validate stock if selling
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    currency_id uuid, foreign_amount numeric, rate numeric, idr_amount numeric
  )
  LOOP
    v_total_idr := v_total_idr + v_item.idr_amount;

    IF v_type = 'sell' AND v_effective_branch_id IS NOT NULL THEN
      SELECT COALESCE(balance, 0) INTO v_curr_balance
      FROM public.cash_balances
      WHERE branch_id = v_effective_branch_id AND currency_id = v_item.currency_id;

      IF COALESCE(v_curr_balance, 0) < v_item.foreign_amount THEN
        RAISE EXCEPTION 'Stok kas cabang tidak mencukupi untuk mata uang yang dipilih (stok tersedia: %)', COALESCE(v_curr_balance, 0);
      END IF;
    END IF;
  END LOOP;

  -- First item details for header compatibility
  SELECT 
    (p_items->0->>'currency_id')::uuid,
    (p_items->0->>'foreign_amount')::numeric,
    (p_items->0->>'rate')::numeric
  INTO v_first_curr, v_first_foreign, v_first_rate;

  -- 1. Insert transaction header
  INSERT INTO public.transactions (
    branch_id, customer_id, transaction_type,
    currency_id, foreign_amount, rate, idr_amount,
    payment_method, status, notes, teller_id, transaction_date
  ) VALUES (
    v_effective_branch_id, p_customer_id, v_type,
    v_first_curr, v_first_foreign, v_first_rate, v_total_idr,
    v_pay, 'completed', p_notes, auth.uid(), COALESCE(p_transaction_date, now())
  ) RETURNING * INTO v_tx;

  -- 2. Insert line items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    currency_id uuid, foreign_amount numeric, rate numeric, idr_amount numeric
  )
  LOOP
    INSERT INTO public.transaction_items (
      transaction_id, currency_id, foreign_amount, rate, idr_amount, created_at
    ) VALUES (
      v_tx.id, v_item.currency_id, v_item.foreign_amount, v_item.rate, v_item.idr_amount, v_tx.transaction_date
    );
  END LOOP;

  -- Return complete transaction representation
  SELECT to_jsonb(t) INTO v_res FROM (
    SELECT 
      v_tx.id,
      v_tx.transaction_no,
      v_tx.transaction_type,
      v_tx.transaction_date,
      v_tx.branch_id,
      v_tx.customer_id,
      v_tx.currency_id,
      v_tx.foreign_amount,
      v_tx.rate,
      v_tx.idr_amount,
      v_tx.payment_method,
      v_tx.status,
      v_tx.notes,
      v_tx.teller_id,
      v_tx.created_at,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'id', ti.id,
          'currency_id', ti.currency_id,
          'foreign_amount', ti.foreign_amount,
          'rate', ti.rate,
          'idr_amount', ti.idr_amount,
          'currencies', jsonb_build_object('code', c.code, 'name', c.name)
        ))
        FROM public.transaction_items ti
        JOIN public.currencies c ON c.id = ti.currency_id
        WHERE ti.transaction_id = v_tx.id
      ) as transaction_items
  ) t;

  RETURN v_res;
END;
$function$;

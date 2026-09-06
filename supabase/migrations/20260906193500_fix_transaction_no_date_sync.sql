-- =====================================================================
-- Migration: Fix transaction number and transaction date synchronization
-- =====================================================================

-- 1. Ensure generate_transaction_no uses Asia/Makassar timezone for transaction_date
CREATE OR REPLACE FUNCTION public.generate_transaction_no()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_branch_name text := '';
  v_branch_code text := '';
  v_branch_letter text := 'J'; -- Default Kantor Pusat (Jimbaran)
  v_type_num text := '1';      -- 1 = Beli (Buy), 2 = Jual (Sell)
  v_date_str text;
  v_prefix text;
  next_seq int;
BEGIN
  -- Hanya buat nomor baru jika belum diisi atau masih berformat default lama
  IF NEW.transaction_no IS NULL OR NEW.transaction_no = '' OR NEW.transaction_no LIKE 'TRX-%' THEN
    -- 1. Tentukan nomor jenis transaksi (1 = Beli, 2 = Jual)
    IF NEW.transaction_type = 'sell' THEN
      v_type_num := '2';
    ELSE
      v_type_num := '1';
    END IF;

    -- 2. Tentukan kode cabang (J = Pusat/Jimbaran, C = Canggu, L = Legian)
    IF NEW.branch_id IS NOT NULL THEN
      SELECT name, code INTO v_branch_name, v_branch_code
      FROM public.branches
      WHERE id = NEW.branch_id;

      IF v_branch_name ILIKE '%canggu%' OR v_branch_code ILIKE '%canggu%' THEN
        v_branch_letter := 'C';
      ELSIF v_branch_name ILIKE '%legian%' OR v_branch_code ILIKE '%legian%' THEN
        v_branch_letter := 'L';
      ELSIF v_branch_name ILIKE '%pusat%' OR v_branch_name ILIKE '%jimbaran%' OR v_branch_code ILIKE '%HQ%' THEN
        v_branch_letter := 'J';
      ELSE
        v_branch_letter := COALESCE(NULLIF(UPPER(SUBSTRING(v_branch_name FROM 1 FOR 1)), ''), 'J');
      END IF;
    ELSE
      v_branch_letter := 'J';
    END IF;

    -- 3. Format tanggal YYYYMMDD (WITA / UTC+8)
    v_date_str := to_char(COALESCE(NEW.transaction_date AT TIME ZONE 'Asia/Makassar', timezone('Asia/Makassar', now())), 'YYYYMMDD');

    -- 4. Gabungkan prefix: AMV[J/C/L][1/2]-YYYYMMDD-
    v_prefix := 'AMV' || v_branch_letter || v_type_num || '-' || v_date_str || '-';

    -- 5. Hitung sequence berikutnya untuk prefix dan tanggal tersebut
    SELECT COALESCE(MAX(SUBSTRING(transaction_no FROM '\d+$')::int), 0) + 1
      INTO next_seq
      FROM public.transactions
      WHERE transaction_no LIKE v_prefix || '%';

    -- 6. Format nomor: AMVJ1-YYYYMMDD-001 (3 digit padding)
    NEW.transaction_no := v_prefix || lpad(next_seq::text, 3, '0');
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Update admin_edit_transaction to properly update transaction_no prefix when date changes
CREATE OR REPLACE FUNCTION public.admin_edit_transaction(
  p_tx_id uuid,
  p_foreign_amount numeric,
  p_idr_amount numeric,
  p_rate numeric,
  p_customer_id uuid,
  p_notes text,
  p_date timestamptz,
  p_currency_id uuid DEFAULT NULL,
  p_items jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_tx record;
  idr_id uuid;
  v_primary_currency_id uuid;
  v_primary_foreign_amount numeric;
  v_primary_rate numeric;
  v_total_idr numeric;
  v_old_prefix text;
  v_new_prefix text;
  v_branch_name text := '';
  v_branch_code text := '';
  v_branch_letter text := 'J';
  v_type_num text := '1';
  v_date_str text;
  v_final_tx_no text;
  v_mv record;
  v_item record;
  v_idr_mv numeric;
BEGIN
  -- Verify role
  IF NOT (has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'Access denied. Only super_admin or owner can edit transactions.';
  END IF;

  -- Get old transaction
  SELECT * INTO v_old_tx FROM public.transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Get IDR currency ID
  SELECT id INTO idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  -- Determine items to use
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    v_primary_currency_id := (p_items->0->>'currency_id')::uuid;
    v_primary_foreign_amount := (p_items->0->>'foreign_amount')::numeric;
    v_primary_rate := (p_items->0->>'rate')::numeric;
    
    SELECT COALESCE(SUM((elem->>'idr_amount')::numeric), 0)
    INTO v_total_idr
    FROM jsonb_array_elements(p_items) AS elem;
  ELSE
    v_primary_currency_id := COALESCE(p_currency_id, v_old_tx.currency_id);
    v_primary_foreign_amount := p_foreign_amount;
    v_primary_rate := p_rate;
    v_total_idr := p_idr_amount;
  END IF;

  -- Determine old prefix
  v_old_prefix := substring(v_old_tx.transaction_no from 1 for length(v_old_tx.transaction_no) - 3);

  -- Determine new prefix based on branch, type, and target date
  IF v_old_tx.transaction_type = 'sell' THEN
    v_type_num := '2';
  ELSE
    v_type_num := '1';
  END IF;

  IF v_old_tx.branch_id IS NOT NULL THEN
    SELECT name, code INTO v_branch_name, v_branch_code FROM public.branches WHERE id = v_old_tx.branch_id;
    IF v_branch_name ILIKE '%canggu%' OR v_branch_code ILIKE '%canggu%' THEN
      v_branch_letter := 'C';
    ELSIF v_branch_name ILIKE '%legian%' OR v_branch_code ILIKE '%legian%' THEN
      v_branch_letter := 'L';
    ELSIF v_branch_name ILIKE '%pusat%' OR v_branch_name ILIKE '%jimbaran%' OR v_branch_code ILIKE '%HQ%' THEN
      v_branch_letter := 'J';
    ELSE
      v_branch_letter := COALESCE(NULLIF(UPPER(SUBSTRING(v_branch_name FROM 1 FOR 1)), ''), 'J');
    END IF;
  ELSE
    v_branch_letter := 'J';
  END IF;

  v_date_str := to_char(p_date AT TIME ZONE 'Asia/Makassar', 'YYYYMMDD');
  v_new_prefix := 'AMV' || v_branch_letter || v_type_num || '-' || v_date_str || '-';

  -- 1. If completed and branch is set, revert old movements & physical cash balances
  IF v_old_tx.status = 'completed' AND v_old_tx.branch_id IS NOT NULL THEN
    FOR v_mv IN
      SELECT * FROM public.cash_movements
      WHERE reference_id = p_tx_id
         OR (reference_id IS NULL AND reference_no = v_old_tx.transaction_no)
    LOOP
      UPDATE public.cash_balances
        SET balance = balance - v_mv.amount, updated_at = now()
        WHERE branch_id = v_mv.branch_id AND currency_id = v_mv.currency_id;
      DELETE FROM public.cash_movements WHERE id = v_mv.id;
    END LOOP;
  END IF;

  -- 2. Update transaction record
  UPDATE public.transactions
  SET
    currency_id = v_primary_currency_id,
    foreign_amount = v_primary_foreign_amount,
    idr_amount = v_total_idr,
    rate = v_primary_rate,
    customer_id = p_customer_id,
    notes = p_notes,
    transaction_date = p_date,
    updated_at = now()
  WHERE id = p_tx_id;

  -- 3. Replace transaction_items
  DELETE FROM public.transaction_items WHERE transaction_id = p_tx_id;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN
      SELECT 
        (elem->>'currency_id')::uuid as currency_id,
        (elem->>'foreign_amount')::numeric as foreign_amount,
        (elem->>'rate')::numeric as rate,
        (elem->>'idr_amount')::numeric as idr_amount
      FROM jsonb_array_elements(p_items) AS elem
    LOOP
      INSERT INTO public.transaction_items (
        transaction_id, currency_id, foreign_amount, rate, idr_amount, created_at
      ) VALUES (
        p_tx_id, v_item.currency_id, v_item.foreign_amount, v_item.rate, v_item.idr_amount, p_date
      );
    END LOOP;
  ELSE
    INSERT INTO public.transaction_items (
      transaction_id, currency_id, foreign_amount, rate, idr_amount, created_at
    ) VALUES (
      p_tx_id, v_primary_currency_id, v_primary_foreign_amount, v_primary_rate, v_total_idr, p_date
    );
  END IF;

  -- 4. Post new IDR cash movement if completed
  IF v_old_tx.status = 'completed' AND v_old_tx.branch_id IS NOT NULL AND idr_id IS NOT NULL THEN
    IF v_old_tx.transaction_type = 'buy' THEN
      v_idr_mv := -v_total_idr;
    ELSE
      v_idr_mv := v_total_idr;
    END IF;

    INSERT INTO public.cash_movements (
      branch_id, currency_id, movement_type, amount,
      reference_id, reference_no, notes, created_by, created_at
    ) VALUES (
      v_old_tx.branch_id, idr_id,
      v_old_tx.transaction_type::text::public.cash_movement_type,
      v_idr_mv, p_tx_id, v_old_tx.transaction_no,
      'Auto dari transaksi (IDR)', v_old_tx.teller_id, p_date
    );
  END IF;

  -- If prefix changed, assign provisional transaction_no on the new prefix so renumber picks it up
  IF v_old_prefix <> v_new_prefix THEN
    UPDATE public.transactions
    SET transaction_no = v_new_prefix || 'TMP-' || p_tx_id::text
    WHERE id = p_tx_id;
  END IF;

  -- 5. Renumber transactions chronologically on new prefix
  PERFORM public.renumber_transactions_by_prefix(v_new_prefix);

  -- 6. If prefix changed, also renumber the old prefix so there are no gaps
  IF v_old_prefix <> v_new_prefix THEN
    PERFORM public.renumber_transactions_by_prefix(v_old_prefix);
  END IF;

  -- Get final transaction_no
  SELECT transaction_no INTO v_final_tx_no FROM public.transactions WHERE id = p_tx_id;

  -- 7. Update reference_no in cash_movements to final transaction_no
  UPDATE public.cash_movements
  SET reference_no = v_final_tx_no
  WHERE reference_id = p_tx_id;

  -- 8. Recalculate balance_after for cash_movements in that branch
  IF v_old_tx.branch_id IS NOT NULL THEN
    WITH running AS (
      SELECT id, SUM(amount) OVER (
        PARTITION BY branch_id, currency_id 
        ORDER BY created_at ASC, id ASC
      ) as calc_balance
      FROM public.cash_movements
      WHERE branch_id = v_old_tx.branch_id
    )
    UPDATE public.cash_movements cm
    SET balance_after = running.calc_balance
    FROM running
    WHERE cm.id = running.id;
  END IF;

  RETURN v_final_tx_no;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_edit_transaction(uuid, numeric, numeric, numeric, uuid, text, timestamptz, uuid, jsonb) TO authenticated;

-- 3. Resync the 2 mismatched transactions currently in database
DO $$
BEGIN
  -- da4622f0-4bda-4069-b26a-0c870f8d0508: 2026-09-02
  UPDATE public.transactions
  SET transaction_no = 'AMVJ2-20260902-TMP'
  WHERE id = 'da4622f0-4bda-4069-b26a-0c870f8d0508';

  -- 30b53543-d383-472d-b3dd-cda7335218a3: 2026-09-05
  UPDATE public.transactions
  SET transaction_no = 'AMVJ2-20260905-TMP'
  WHERE id = '30b53543-d383-472d-b3dd-cda7335218a3';

  -- Renumber prefixes
  PERFORM public.renumber_transactions_by_prefix('AMVJ2-20260902-');
  PERFORM public.renumber_transactions_by_prefix('AMVJ2-20260905-');
  PERFORM public.renumber_transactions_by_prefix('AMVJ2-20260906-');
END $$;

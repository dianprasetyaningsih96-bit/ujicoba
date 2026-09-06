-- Migration: Chronological transaction renumbering on edit, live preview, and currency editing
-- 1. Function to renumber transactions sequentially and chronologically for a specific prefix
CREATE OR REPLACE FUNCTION public.renumber_transactions_by_prefix(p_prefix text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  i int := 0;
  v_new_no text;
BEGIN
  -- Rename to temporary numbers to avoid UNIQUE constraint violations during reassignment
  UPDATE public.transactions
  SET transaction_no = 'TMP-' || id::text
  WHERE transaction_no LIKE p_prefix || '%';

  -- Loop through all transactions for this prefix in strict chronological order
  FOR r IN
    SELECT id
    FROM public.transactions
    WHERE transaction_no LIKE 'TMP-%'
    ORDER BY transaction_date ASC, created_at ASC
  LOOP
    i := i + 1;
    v_new_no := p_prefix || lpad(i::text, 3, '0');

    UPDATE public.transactions
    SET transaction_no = v_new_no
    WHERE id = r.id;

    -- Synchronize cash_movements reference_no for this transaction
    UPDATE public.cash_movements
    SET reference_no = v_new_no
    WHERE reference_id = r.id;
  END LOOP;
END;
$function$;

-- 2. Function to renumber all existing transactions across all prefixes
CREATE OR REPLACE FUNCTION public.renumber_all_transactions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT DISTINCT substring(transaction_no from 1 for length(transaction_no) - 3) as prefix
    FROM public.transactions
    WHERE transaction_no NOT LIKE 'TMP-%'
  LOOP
    PERFORM public.renumber_transactions_by_prefix(p.prefix);
  END LOOP;
END;
$function$;

-- Execute one-time renumbering of all existing transactions
SELECT public.renumber_all_transactions();

-- 3. Function to preview transaction_no in real-time when date/time is selected
CREATE OR REPLACE FUNCTION public.get_preview_transaction_no(
  p_tx_id uuid,
  p_date timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx record;
  v_branch_name text := '';
  v_branch_code text := '';
  v_branch_letter text := 'J';
  v_type_num text := '1';
  v_date_str text;
  v_prefix text;
  v_seq int := 1;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_tx.transaction_type = 'sell' THEN
    v_type_num := '2';
  ELSE
    v_type_num := '1';
  END IF;

  IF v_tx.branch_id IS NOT NULL THEN
    SELECT name, code INTO v_branch_name, v_branch_code
    FROM public.branches WHERE id = v_tx.branch_id;
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
  v_prefix := 'AMV' || v_branch_letter || v_type_num || '-' || v_date_str || '-';

  -- Count how many other transactions for the same prefix are earlier than p_date
  SELECT COUNT(*) + 1
  INTO v_seq
  FROM public.transactions
  WHERE id != p_tx_id
    AND transaction_no LIKE v_prefix || '%'
    AND (
      transaction_date < p_date
      OR (transaction_date = p_date AND created_at <= v_tx.created_at)
    );

  RETURN v_prefix || lpad(v_seq::text, 3, '0');
END;
$function$;

-- 4. Update admin_edit_transaction to support currency change and automatic chronological renumbering
DROP FUNCTION IF EXISTS public.admin_edit_transaction(uuid, numeric, numeric, numeric, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.admin_edit_transaction(uuid, numeric, numeric, numeric, uuid, text, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.admin_edit_transaction(
  p_tx_id uuid,
  p_foreign_amount numeric,
  p_idr_amount numeric,
  p_rate numeric,
  p_customer_id uuid,
  p_notes text,
  p_date timestamptz,
  p_currency_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_tx record;
  idr_id uuid;
  v_new_currency_id uuid;
  v_old_prefix text;
  v_new_prefix text;
  v_branch_name text := '';
  v_branch_code text := '';
  v_branch_letter text := 'J';
  v_type_num text := '1';
  v_date_str text;
  v_foreign_delta numeric := 0;
  v_idr_delta numeric := 0;
  v_final_tx_no text;
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

  -- Determine new currency
  v_new_currency_id := COALESCE(p_currency_id, v_old_tx.currency_id);

  -- Get IDR id
  SELECT id INTO idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

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

  -- 1. If completed and branch is set, adjust physical cash balances & movements
  IF v_old_tx.status = 'completed' AND v_old_tx.branch_id IS NOT NULL THEN
    -- A. Check if currency changed
    IF v_new_currency_id <> v_old_tx.currency_id THEN
      -- Revert old foreign currency from branch balance
      IF v_old_tx.transaction_type = 'buy' THEN
        -- Was buy: branch received foreign cash, so now deduct it
        UPDATE public.cash_balances
        SET balance = balance - v_old_tx.foreign_amount, updated_at = now()
        WHERE branch_id = v_old_tx.branch_id AND currency_id = v_old_tx.currency_id;
      ELSE
        -- Was sell: branch gave foreign cash, so now return it
        UPDATE public.cash_balances
        SET balance = balance + v_old_tx.foreign_amount, updated_at = now()
        WHERE branch_id = v_old_tx.branch_id AND currency_id = v_old_tx.currency_id;
      END IF;

      -- Apply new foreign currency to branch balance
      IF v_old_tx.transaction_type = 'buy' THEN
        INSERT INTO public.cash_balances (branch_id, currency_id, balance)
        VALUES (v_old_tx.branch_id, v_new_currency_id, p_foreign_amount)
        ON CONFLICT (branch_id, currency_id)
        DO UPDATE SET balance = public.cash_balances.balance + p_foreign_amount, updated_at = now();
      ELSE
        INSERT INTO public.cash_balances (branch_id, currency_id, balance)
        VALUES (v_old_tx.branch_id, v_new_currency_id, -p_foreign_amount)
        ON CONFLICT (branch_id, currency_id)
        DO UPDATE SET balance = public.cash_balances.balance - p_foreign_amount, updated_at = now();
      END IF;

      -- Update foreign cash_movement to new currency & amount
      UPDATE public.cash_movements
      SET amount = CASE WHEN v_old_tx.transaction_type = 'buy' THEN p_foreign_amount ELSE -p_foreign_amount END,
          currency_id = v_new_currency_id,
          created_at = p_date
      WHERE reference_id = p_tx_id
        AND currency_id = v_old_tx.currency_id
        AND movement_type = v_old_tx.transaction_type::text::public.cash_movement_type;

    ELSE
      -- Currency is unchanged: calculate foreign delta
      IF v_old_tx.transaction_type = 'buy' THEN
        v_foreign_delta := p_foreign_amount - v_old_tx.foreign_amount;
      ELSE
        v_foreign_delta := -(p_foreign_amount - v_old_tx.foreign_amount);
      END IF;

      IF v_foreign_delta <> 0 THEN
        UPDATE public.cash_balances
        SET balance = balance + v_foreign_delta, updated_at = now()
        WHERE branch_id = v_old_tx.branch_id AND currency_id = v_old_tx.currency_id;
      END IF;

      UPDATE public.cash_movements
      SET amount = CASE WHEN v_old_tx.transaction_type = 'buy' THEN p_foreign_amount ELSE -p_foreign_amount END,
          created_at = p_date
      WHERE reference_id = p_tx_id
        AND currency_id = v_old_tx.currency_id
        AND movement_type = v_old_tx.transaction_type::text::public.cash_movement_type;
    END IF;

    -- B. Update IDR balance & cash_movement
    IF v_old_tx.transaction_type = 'buy' THEN
      v_idr_delta := -(p_idr_amount - v_old_tx.idr_amount);
    ELSE
      v_idr_delta := p_idr_amount - v_old_tx.idr_amount;
    END IF;

    IF v_idr_delta <> 0 AND idr_id IS NOT NULL THEN
      UPDATE public.cash_balances
      SET balance = balance + v_idr_delta, updated_at = now()
      WHERE branch_id = v_old_tx.branch_id AND currency_id = idr_id;
    END IF;

    IF idr_id IS NOT NULL THEN
      UPDATE public.cash_movements
      SET amount = CASE WHEN v_old_tx.transaction_type = 'buy' THEN -p_idr_amount ELSE p_idr_amount END,
          created_at = p_date
      WHERE reference_id = p_tx_id
        AND currency_id = idr_id
        AND movement_type = v_old_tx.transaction_type::text::public.cash_movement_type;
    END IF;

    -- Recalculate balance_after for cash_movements in affected currencies
    WITH running AS (
      SELECT id, SUM(amount) OVER (
        PARTITION BY branch_id, currency_id 
        ORDER BY created_at ASC, id ASC
      ) as calc_balance
      FROM public.cash_movements
      WHERE branch_id = v_old_tx.branch_id 
        AND currency_id IN (v_old_tx.currency_id, v_new_currency_id, idr_id)
    )
    UPDATE public.cash_movements cm
    SET balance_after = running.calc_balance
    FROM running
    WHERE cm.id = running.id;
  END IF;

  -- 2. Update transaction record
  UPDATE public.transactions
  SET
    currency_id = v_new_currency_id,
    foreign_amount = p_foreign_amount,
    idr_amount = p_idr_amount,
    rate = p_rate,
    customer_id = p_customer_id,
    notes = p_notes,
    transaction_date = p_date,
    updated_at = now()
  WHERE id = p_tx_id;

  -- 3. Renumber transactions chronologically on new prefix
  PERFORM public.renumber_transactions_by_prefix(v_new_prefix);

  -- 4. If prefix changed, also renumber the old prefix so there are no gaps
  IF v_old_prefix <> v_new_prefix THEN
    PERFORM public.renumber_transactions_by_prefix(v_old_prefix);
  END IF;

  -- Get final transaction_no
  SELECT transaction_no INTO v_final_tx_no FROM public.transactions WHERE id = p_tx_id;

  RETURN v_final_tx_no;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_preview_transaction_no(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_transaction(uuid, numeric, numeric, numeric, uuid, text, timestamptz, uuid) TO authenticated;


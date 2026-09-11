-- ==============================================================================
-- Migration: Configurable Transaction Number Prefix (Buy & Sell)
-- ==============================================================================

-- 1. Add prefix configuration columns to app_settings
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS tx_prefix_company text DEFAULT 'AMV',
  ADD COLUMN IF NOT EXISTS tx_prefix_buy text DEFAULT '1',
  ADD COLUMN IF NOT EXISTS tx_prefix_sell text DEFAULT '2';

UPDATE public.app_settings
SET
  tx_prefix_company = COALESCE(NULLIF(TRIM(tx_prefix_company), ''), 'AMV'),
  tx_prefix_buy = COALESCE(NULLIF(TRIM(tx_prefix_buy), ''), '1'),
  tx_prefix_sell = COALESCE(NULLIF(TRIM(tx_prefix_sell), ''), '2')
WHERE id = true;

-- 2. Add branch_letter column to branches for flexible branch initials
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS branch_letter text;

UPDATE public.branches
SET branch_letter = CASE
  WHEN name ILIKE '%legian%' OR code ILIKE '%legian%' THEN 'L'
  WHEN name ILIKE '%canggu%' OR code ILIKE '%canggu%' THEN 'C'
  WHEN is_head_office = true OR name ILIKE '%pusat%' OR name ILIKE '%jimbaran%' THEN 'J'
  ELSE UPPER(SUBSTRING(name FROM 1 FOR 1))
END
WHERE branch_letter IS NULL;

-- 3. Update generate_transaction_no() to use configurable prefixes
CREATE OR REPLACE FUNCTION public.generate_transaction_no()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_company_prefix text := 'AMV';
  v_buy_code text := '1';
  v_sell_code text := '2';
  v_type_num text := '1';
  v_branch_name text := '';
  v_branch_code text := '';
  v_branch_letter_col text := '';
  v_branch_letter text := 'J'; -- Default Kantor Pusat (Jimbaran)
  v_date_str text;
  v_prefix text;
  next_seq int;
BEGIN
  -- Hanya buat nomor baru jika belum diisi atau masih berformat default lama
  IF NEW.transaction_no IS NULL OR NEW.transaction_no = '' OR NEW.transaction_no LIKE 'TRX-%' THEN
    -- Ambil konfigurasi prefix dari app_settings
    SELECT 
      COALESCE(NULLIF(TRIM(tx_prefix_company), ''), 'AMV'),
      COALESCE(NULLIF(TRIM(tx_prefix_buy), ''), '1'),
      COALESCE(NULLIF(TRIM(tx_prefix_sell), ''), '2')
    INTO v_company_prefix, v_buy_code, v_sell_code
    FROM public.app_settings
    WHERE id = true;

    IF v_company_prefix IS NULL THEN v_company_prefix := 'AMV'; END IF;
    IF v_buy_code IS NULL THEN v_buy_code := '1'; END IF;
    IF v_sell_code IS NULL THEN v_sell_code := '2'; END IF;

    -- 1. Tentukan nomor/kode jenis transaksi (Beli vs Jual)
    IF NEW.transaction_type = 'sell' THEN
      v_type_num := v_sell_code;
    ELSE
      v_type_num := v_buy_code;
    END IF;

    -- 2. Tentukan kode cabang
    IF NEW.branch_id IS NOT NULL THEN
      SELECT name, code, branch_letter 
      INTO v_branch_name, v_branch_code, v_branch_letter_col
      FROM public.branches
      WHERE id = NEW.branch_id;

      IF v_branch_letter_col IS NOT NULL AND TRIM(v_branch_letter_col) <> '' THEN
        v_branch_letter := UPPER(TRIM(v_branch_letter_col));
      ELSIF v_branch_name ILIKE '%canggu%' OR v_branch_code ILIKE '%canggu%' THEN
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

    -- 4. Gabungkan prefix: [v_company_prefix][v_branch_letter][v_type_num]-[YYYYMMDD]-
    v_prefix := v_company_prefix || v_branch_letter || v_type_num || '-' || v_date_str || '-';

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

-- 4. Update get_preview_transaction_no(uuid, timestamptz)
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
  v_company_prefix text := 'AMV';
  v_buy_code text := '1';
  v_sell_code text := '2';
  v_branch_name text := '';
  v_branch_code text := '';
  v_branch_letter_col text := '';
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

  SELECT 
    COALESCE(NULLIF(TRIM(tx_prefix_company), ''), 'AMV'),
    COALESCE(NULLIF(TRIM(tx_prefix_buy), ''), '1'),
    COALESCE(NULLIF(TRIM(tx_prefix_sell), ''), '2')
  INTO v_company_prefix, v_buy_code, v_sell_code
  FROM public.app_settings
  WHERE id = true;

  IF v_company_prefix IS NULL THEN v_company_prefix := 'AMV'; END IF;
  IF v_buy_code IS NULL THEN v_buy_code := '1'; END IF;
  IF v_sell_code IS NULL THEN v_sell_code := '2'; END IF;

  IF v_tx.transaction_type = 'sell' THEN
    v_type_num := v_sell_code;
  ELSE
    v_type_num := v_buy_code;
  END IF;

  IF v_tx.branch_id IS NOT NULL THEN
    SELECT name, code, branch_letter 
    INTO v_branch_name, v_branch_code, v_branch_letter_col
    FROM public.branches WHERE id = v_tx.branch_id;

    IF v_branch_letter_col IS NOT NULL AND TRIM(v_branch_letter_col) <> '' THEN
      v_branch_letter := UPPER(TRIM(v_branch_letter_col));
    ELSIF v_branch_name ILIKE '%canggu%' OR v_branch_code ILIKE '%canggu%' THEN
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
  v_prefix := v_company_prefix || v_branch_letter || v_type_num || '-' || v_date_str || '-';

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

-- 5. Update admin_edit_transaction(...)
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
  v_company_prefix text := 'AMV';
  v_buy_code text := '1';
  v_sell_code text := '2';
  v_branch_name text := '';
  v_branch_code text := '';
  v_branch_letter_col text := '';
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

  -- Ambil konfigurasi prefix dari app_settings
  SELECT 
    COALESCE(NULLIF(TRIM(tx_prefix_company), ''), 'AMV'),
    COALESCE(NULLIF(TRIM(tx_prefix_buy), ''), '1'),
    COALESCE(NULLIF(TRIM(tx_prefix_sell), ''), '2')
  INTO v_company_prefix, v_buy_code, v_sell_code
  FROM public.app_settings
  WHERE id = true;

  IF v_company_prefix IS NULL THEN v_company_prefix := 'AMV'; END IF;
  IF v_buy_code IS NULL THEN v_buy_code := '1'; END IF;
  IF v_sell_code IS NULL THEN v_sell_code := '2'; END IF;

  -- Determine primary items
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    SELECT 
      (p_items->0->>'currency_id')::uuid,
      (p_items->0->>'foreign_amount')::numeric,
      (p_items->0->>'rate')::numeric
    INTO v_primary_currency_id, v_primary_foreign_amount, v_primary_rate;

    SELECT COALESCE(SUM((elem->>'idr_amount')::numeric), 0)
    INTO v_total_idr
    FROM jsonb_array_elements(p_items) AS elem;
  ELSE
    v_primary_currency_id := COALESCE(p_currency_id, v_old_tx.currency_id);
    v_primary_foreign_amount := p_foreign_amount;
    v_primary_rate := p_rate;
    v_total_idr := p_idr_amount;
  END IF;

  -- Get IDR id
  SELECT id INTO idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  -- Determine old prefix
  v_old_prefix := substring(v_old_tx.transaction_no from 1 for length(v_old_tx.transaction_no) - 3);

  -- Determine new prefix based on branch, type, and target date
  IF v_old_tx.transaction_type = 'sell' THEN
    v_type_num := v_sell_code;
  ELSE
    v_type_num := v_buy_code;
  END IF;

  IF v_old_tx.branch_id IS NOT NULL THEN
    SELECT name, code, branch_letter 
    INTO v_branch_name, v_branch_code, v_branch_letter_col
    FROM public.branches WHERE id = v_old_tx.branch_id;

    IF v_branch_letter_col IS NOT NULL AND TRIM(v_branch_letter_col) <> '' THEN
      v_branch_letter := UPPER(TRIM(v_branch_letter_col));
    ELSIF v_branch_name ILIKE '%canggu%' OR v_branch_code ILIKE '%canggu%' THEN
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
  v_new_prefix := v_company_prefix || v_branch_letter || v_type_num || '-' || v_date_str || '-';

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

  -- 4. Post new physical cash movements & update balances if completed
  IF v_old_tx.status = 'completed' AND v_old_tx.branch_id IS NOT NULL THEN
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      FOR v_item IN
        SELECT 
          (elem->>'currency_id')::uuid as currency_id,
          (elem->>'foreign_amount')::numeric as foreign_amount,
          (elem->>'rate')::numeric as rate,
          (elem->>'idr_amount')::numeric as idr_amount
        FROM jsonb_array_elements(p_items) AS elem
      LOOP
        IF v_old_tx.transaction_type = 'buy' THEN
          INSERT INTO public.cash_balances (branch_id, currency_id, balance)
          VALUES (v_old_tx.branch_id, v_item.currency_id, v_item.foreign_amount)
          ON CONFLICT (branch_id, currency_id)
          DO UPDATE SET balance = public.cash_balances.balance + v_item.foreign_amount, updated_at = now();
        ELSE
          INSERT INTO public.cash_balances (branch_id, currency_id, balance)
          VALUES (v_old_tx.branch_id, v_item.currency_id, -v_item.foreign_amount)
          ON CONFLICT (branch_id, currency_id)
          DO UPDATE SET balance = public.cash_balances.balance - v_item.foreign_amount, updated_at = now();
        END IF;

        INSERT INTO public.cash_movements (
          branch_id, currency_id, movement_type, amount,
          reference_id, reference_no, notes, created_by, created_at
        ) VALUES (
          v_old_tx.branch_id, v_item.currency_id,
          v_old_tx.transaction_type::text::public.cash_movement_type,
          CASE WHEN v_old_tx.transaction_type = 'buy' THEN v_item.foreign_amount ELSE -v_item.foreign_amount END,
          p_tx_id, v_old_tx.transaction_no,
          'Auto dari transaksi', v_old_tx.teller_id, p_date
        );
      END LOOP;
    ELSE
      IF v_old_tx.transaction_type = 'buy' THEN
        INSERT INTO public.cash_balances (branch_id, currency_id, balance)
        VALUES (v_old_tx.branch_id, v_primary_currency_id, v_primary_foreign_amount)
        ON CONFLICT (branch_id, currency_id)
        DO UPDATE SET balance = public.cash_balances.balance + v_primary_foreign_amount, updated_at = now();
      ELSE
        INSERT INTO public.cash_balances (branch_id, currency_id, balance)
        VALUES (v_old_tx.branch_id, v_primary_currency_id, -v_primary_foreign_amount)
        ON CONFLICT (branch_id, currency_id)
        DO UPDATE SET balance = public.cash_balances.balance - v_primary_foreign_amount, updated_at = now();
      END IF;

      INSERT INTO public.cash_movements (
        branch_id, currency_id, movement_type, amount,
        reference_id, reference_no, notes, created_by, created_at
      ) VALUES (
        v_old_tx.branch_id, v_primary_currency_id,
        v_old_tx.transaction_type::text::public.cash_movement_type,
        CASE WHEN v_old_tx.transaction_type = 'buy' THEN v_primary_foreign_amount ELSE -v_primary_foreign_amount END,
        p_tx_id, v_old_tx.transaction_no,
        'Auto dari transaksi', v_old_tx.teller_id, p_date
      );
    END IF;

    -- Update IDR cash balance & movement
    IF idr_id IS NOT NULL THEN
      IF v_old_tx.transaction_type = 'buy' THEN
        v_idr_mv := -v_total_idr;
      ELSE
        v_idr_mv := v_total_idr;
      END IF;

      INSERT INTO public.cash_balances (branch_id, currency_id, balance)
      VALUES (v_old_tx.branch_id, idr_id, v_idr_mv)
      ON CONFLICT (branch_id, currency_id)
      DO UPDATE SET balance = public.cash_balances.balance + v_idr_mv, updated_at = now();

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

GRANT EXECUTE ON FUNCTION public.get_preview_transaction_no(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_transaction(uuid, numeric, numeric, numeric, uuid, text, timestamptz, uuid, jsonb) TO authenticated;

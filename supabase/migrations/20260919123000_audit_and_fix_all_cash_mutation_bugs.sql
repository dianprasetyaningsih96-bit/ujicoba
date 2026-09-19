-- =====================================================================
-- PERBAIKAN KOMPREHENSIF AKUNTANSI KAS (AUDIT)
-- Ditemukan 3 skenario dimana cash_movements dicatat namun
-- cash_balances TIDAK diupdate (atau diupdate sebagian):
-- 1. Mutasi Manual dari frontend (cash.tsx)
-- 2. Void transaksi (reverse_transaction_cash_movements)
-- 3. Edit transaksi oleh admin (admin_edit_transaction)
-- =====================================================================

-- -----------------------------------------------------------------------
-- 1. RPC UNTUK MUTASI MANUAL DARI FRONTEND
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_manual_cash_movement(
  p_branch_id uuid,
  p_currency_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, notes, created_by, created_at)
  VALUES (p_branch_id, p_currency_id, p_movement_type::public.cash_movement_type, p_amount, p_notes, auth.uid(), now());

  INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
  VALUES (p_branch_id, p_currency_id, p_amount, now())
  ON CONFLICT (branch_id, currency_id)
  DO UPDATE SET balance = public.cash_balances.balance + p_amount, updated_at = now();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_manual_cash_movement(uuid, uuid, text, numeric, text) TO authenticated;

-- -----------------------------------------------------------------------
-- 2. PERBAIKAN VOID TRANSAKSI
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_transaction_cash_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  idr_id uuid;
  v_item record;
  v_has_items boolean := false;
  v_foreign numeric(20,2);
  v_idr numeric(20,2);
BEGIN
  IF NEW.branch_id IS NULL THEN RETURN NEW; END IF;
  
  IF OLD.status = 'completed' AND NEW.status = 'voided' THEN
    SELECT id INTO idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;
    IF idr_id IS NULL THEN RETURN NEW; END IF;

    FOR v_item IN SELECT ti.currency_id, ti.foreign_amount, c.code FROM public.transaction_items ti JOIN public.currencies c ON c.id = ti.currency_id WHERE ti.transaction_id = NEW.id LOOP
      v_has_items := true;
      IF NEW.transaction_type = 'buy' THEN v_foreign := -v_item.foreign_amount; ELSE v_foreign := v_item.foreign_amount; END IF;

      INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by)
      VALUES (NEW.branch_id, v_item.currency_id, 'adjustment', v_foreign, NEW.id, NEW.transaction_no, 'Void transaksi (' || v_item.code || ')', NEW.voided_by);

      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (NEW.branch_id, v_item.currency_id, v_foreign, now())
      ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance + v_foreign, updated_at = now();
    END LOOP;

    IF NOT v_has_items AND NEW.currency_id IS NOT NULL AND NEW.foreign_amount > 0 THEN
      IF NEW.transaction_type = 'buy' THEN v_foreign := -NEW.foreign_amount; ELSE v_foreign := NEW.foreign_amount; END IF;

      INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by)
      VALUES (NEW.branch_id, NEW.currency_id, 'adjustment', v_foreign, NEW.id, NEW.transaction_no, 'Void transaksi', NEW.voided_by);

      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (NEW.branch_id, NEW.currency_id, v_foreign, now())
      ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance + v_foreign, updated_at = now();
    END IF;

    IF NEW.transaction_type = 'buy' THEN v_idr := NEW.idr_amount; ELSE v_idr := -NEW.idr_amount; END IF;

    INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by)
    VALUES (NEW.branch_id, idr_id, 'adjustment', v_idr, NEW.id, NEW.transaction_no, 'Void transaksi (IDR)', NEW.voided_by);

    INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (NEW.branch_id, idr_id, v_idr, now())
    ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance + v_idr, updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;

-- -----------------------------------------------------------------------
-- 3. PERBAIKAN ADMIN EDIT TRANSACTION
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_edit_transaction(
  p_tx_id uuid, p_foreign_amount numeric, p_idr_amount numeric, p_rate numeric,
  p_customer_id uuid, p_notes text, p_date timestamptz, p_currency_id uuid DEFAULT NULL, p_items jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_old_tx record; idr_id uuid; v_primary_currency_id uuid; v_primary_foreign_amount numeric; v_primary_rate numeric;
  v_total_idr numeric; v_old_prefix text; v_new_prefix text; v_branch_name text := ''; v_branch_code text := '';
  v_branch_letter text := 'J'; v_type_num text := '1'; v_date_str text; v_final_tx_no text; v_mv record; v_item record;
  v_idr_mv numeric; v_valas_mv numeric;
BEGIN
  IF NOT (has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'owner')) THEN RAISE EXCEPTION 'Access denied. Only super_admin or owner can edit transactions.'; END IF;

  SELECT * INTO v_old_tx FROM public.transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;

  SELECT id INTO idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    v_primary_currency_id := (p_items->0->>'currency_id')::uuid; v_primary_foreign_amount := (p_items->0->>'foreign_amount')::numeric; v_primary_rate := (p_items->0->>'rate')::numeric;
    SELECT COALESCE(SUM((elem->>'idr_amount')::numeric), 0) INTO v_total_idr FROM jsonb_array_elements(p_items) AS elem;
  ELSE
    v_primary_currency_id := COALESCE(p_currency_id, v_old_tx.currency_id); v_primary_foreign_amount := p_foreign_amount; v_primary_rate := p_rate; v_total_idr := p_idr_amount;
  END IF;

  v_old_prefix := substring(v_old_tx.transaction_no from 1 for length(v_old_tx.transaction_no) - 3);
  IF v_old_tx.transaction_type = 'sell' THEN v_type_num := '2'; ELSE v_type_num := '1'; END IF;

  IF v_old_tx.branch_id IS NOT NULL THEN
    SELECT name, code INTO v_branch_name, v_branch_code FROM public.branches WHERE id = v_old_tx.branch_id;
    IF v_branch_name ILIKE '%canggu%' OR v_branch_code ILIKE '%canggu%' THEN v_branch_letter := 'C';
    ELSIF v_branch_name ILIKE '%legian%' OR v_branch_code ILIKE '%legian%' THEN v_branch_letter := 'L';
    ELSIF v_branch_name ILIKE '%pusat%' OR v_branch_name ILIKE '%jimbaran%' OR v_branch_code ILIKE '%HQ%' THEN v_branch_letter := 'J';
    ELSE v_branch_letter := COALESCE(NULLIF(UPPER(SUBSTRING(v_branch_name FROM 1 FOR 1)), ''), 'J'); END IF;
  ELSE v_branch_letter := 'J'; END IF;

  v_date_str := to_char(p_date AT TIME ZONE 'Asia/Makassar', 'YYYYMMDD');
  v_new_prefix := 'AMV' || v_branch_letter || v_type_num || '-' || v_date_str || '-';

  IF v_old_tx.status = 'completed' AND v_old_tx.branch_id IS NOT NULL THEN
    FOR v_mv IN SELECT * FROM public.cash_movements WHERE reference_id = p_tx_id OR (reference_id IS NULL AND reference_no = v_old_tx.transaction_no) LOOP
      UPDATE public.cash_balances SET balance = balance - v_mv.amount, updated_at = now() WHERE branch_id = v_mv.branch_id AND currency_id = v_mv.currency_id;
      DELETE FROM public.cash_movements WHERE id = v_mv.id;
    END LOOP;
  END IF;

  UPDATE public.transactions SET currency_id = v_primary_currency_id, foreign_amount = v_primary_foreign_amount, idr_amount = v_total_idr, rate = v_primary_rate, customer_id = p_customer_id, notes = p_notes, transaction_date = p_date, updated_at = now() WHERE id = p_tx_id;
  DELETE FROM public.transaction_items WHERE transaction_id = p_tx_id;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT (elem->>'currency_id')::uuid as currency_id, (elem->>'foreign_amount')::numeric as foreign_amount, (elem->>'rate')::numeric as rate, (elem->>'idr_amount')::numeric as idr_amount FROM jsonb_array_elements(p_items) AS elem LOOP
      INSERT INTO public.transaction_items (transaction_id, currency_id, foreign_amount, rate, idr_amount, created_at) VALUES (p_tx_id, v_item.currency_id, v_item.foreign_amount, v_item.rate, v_item.idr_amount, p_date);
      IF v_old_tx.status = 'completed' AND v_old_tx.branch_id IS NOT NULL THEN
        IF v_old_tx.transaction_type = 'buy' THEN v_valas_mv := v_item.foreign_amount; ELSE v_valas_mv := -v_item.foreign_amount; END IF;
        INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by, created_at) VALUES (v_old_tx.branch_id, v_item.currency_id, v_old_tx.transaction_type::text::public.cash_movement_type, v_valas_mv, p_tx_id, v_old_tx.transaction_no, 'Auto dari transaksi valas (Edit)', v_old_tx.teller_id, p_date);
        INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (v_old_tx.branch_id, v_item.currency_id, v_valas_mv, now()) ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance + v_valas_mv, updated_at = now();
      END IF;
    END LOOP;
  ELSE
    INSERT INTO public.transaction_items (transaction_id, currency_id, foreign_amount, rate, idr_amount, created_at) VALUES (p_tx_id, v_primary_currency_id, v_primary_foreign_amount, v_primary_rate, v_total_idr, p_date);
    IF v_old_tx.status = 'completed' AND v_old_tx.branch_id IS NOT NULL THEN
      IF v_old_tx.transaction_type = 'buy' THEN v_valas_mv := v_primary_foreign_amount; ELSE v_valas_mv := -v_primary_foreign_amount; END IF;
      INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by, created_at) VALUES (v_old_tx.branch_id, v_primary_currency_id, v_old_tx.transaction_type::text::public.cash_movement_type, v_valas_mv, p_tx_id, v_old_tx.transaction_no, 'Auto dari transaksi valas (Edit)', v_old_tx.teller_id, p_date);
      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (v_old_tx.branch_id, v_primary_currency_id, v_valas_mv, now()) ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance + v_valas_mv, updated_at = now();
    END IF;
  END IF;

  IF v_old_tx.status = 'completed' AND v_old_tx.branch_id IS NOT NULL AND idr_id IS NOT NULL THEN
    IF v_old_tx.transaction_type = 'buy' THEN v_idr_mv := -v_total_idr; ELSE v_idr_mv := v_total_idr; END IF;
    INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by, created_at) VALUES (v_old_tx.branch_id, idr_id, v_old_tx.transaction_type::text::public.cash_movement_type, v_idr_mv, p_tx_id, v_old_tx.transaction_no, 'Auto dari transaksi (IDR) (Edit)', v_old_tx.teller_id, p_date);
    INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (v_old_tx.branch_id, idr_id, v_idr_mv, now()) ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance + v_idr_mv, updated_at = now();
  END IF;

  IF v_old_prefix <> v_new_prefix THEN UPDATE public.transactions SET transaction_no = v_new_prefix || 'TMP-' || p_tx_id::text WHERE id = p_tx_id; END IF;
  PERFORM public.renumber_transactions_by_prefix(v_new_prefix);
  IF v_old_prefix <> v_new_prefix THEN PERFORM public.renumber_transactions_by_prefix(v_old_prefix); END IF;
  SELECT transaction_no INTO v_final_tx_no FROM public.transactions WHERE id = p_tx_id;
  UPDATE public.cash_movements SET reference_no = v_final_tx_no WHERE reference_id = p_tx_id;

  IF v_old_tx.branch_id IS NOT NULL THEN
    WITH running AS (
      SELECT id, SUM(amount) OVER (PARTITION BY branch_id, currency_id ORDER BY created_at ASC, id ASC) as calc_balance
      FROM public.cash_movements WHERE branch_id = v_old_tx.branch_id
    ) UPDATE public.cash_movements cm SET balance_after = running.calc_balance FROM running WHERE cm.id = running.id;
  END IF;
  RETURN v_final_tx_no;
END;
$function$;

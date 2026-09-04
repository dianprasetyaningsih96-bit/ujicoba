-- 1. Hapus 8 baris mutasi kas penyesuaian yang impas / noise dari edit sebelumnya
DELETE FROM public.cash_movements WHERE notes LIKE 'Edit %';

-- 2. Perbarui fungsi admin_edit_transaction agar langsung mengupdate baris "Transaksi Beli" / "Transaksi Jual" asli
CREATE OR REPLACE FUNCTION public.admin_edit_transaction(
  p_tx_id uuid,
  p_foreign_amount numeric,
  p_idr_amount numeric,
  p_rate numeric,
  p_customer_id uuid,
  p_notes text,
  p_date timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_tx record;
  idr_id uuid;
  v_new_tx_no text;
  v_branch_name text := '';
  v_branch_code text := '';
  v_branch_letter text := 'J';
  v_type_num text := '1';
  v_date_str text;
  v_prefix text;
  next_seq int;
  v_foreign_delta numeric := 0;
  v_idr_delta numeric := 0;
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

  -- Get IDR id
  SELECT id INTO idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  -- Default to existing tx no
  v_new_tx_no := v_old_tx.transaction_no;

  -- If date string (YYYYMMDD) changed, recalculate tx no
  IF to_char(p_date AT TIME ZONE 'Asia/Makassar', 'YYYYMMDD') != to_char(v_old_tx.transaction_date AT TIME ZONE 'Asia/Makassar', 'YYYYMMDD') THEN
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
    END IF;

    v_date_str := to_char(p_date AT TIME ZONE 'Asia/Makassar', 'YYYYMMDD');
    v_prefix := 'AMV' || v_branch_letter || v_type_num || '-' || v_date_str || '-';
    
    SELECT COALESCE(MAX(SUBSTRING(transaction_no FROM '\d+$')::int), 0) + 1
      INTO next_seq
      FROM public.transactions
      WHERE transaction_no LIKE v_prefix || '%';
      
    v_new_tx_no := v_prefix || lpad(next_seq::text, 3, '0');
  END IF;

  -- 1. Jika status completed dan ada perubahan nominal uang, hitung selisih dan update cash_balances
  IF v_old_tx.status = 'completed' AND v_old_tx.branch_id IS NOT NULL THEN
    IF v_old_tx.transaction_type = 'buy' THEN
      v_foreign_delta := p_foreign_amount - v_old_tx.foreign_amount;
      v_idr_delta := -(p_idr_amount - v_old_tx.idr_amount);
    ELSE
      v_foreign_delta := -(p_foreign_amount - v_old_tx.foreign_amount);
      v_idr_delta := p_idr_amount - v_old_tx.idr_amount;
    END IF;

    -- Update saldo fisik valas cabang jika ada selisih
    IF v_foreign_delta <> 0 THEN
      UPDATE public.cash_balances
      SET balance = balance + v_foreign_delta,
          updated_at = now()
      WHERE branch_id = v_old_tx.branch_id AND currency_id = v_old_tx.currency_id;
    END IF;

    -- Update saldo fisik IDR cabang jika ada selisih
    IF v_idr_delta <> 0 AND idr_id IS NOT NULL THEN
      UPDATE public.cash_balances
      SET balance = balance + v_idr_delta,
          updated_at = now()
      WHERE branch_id = v_old_tx.branch_id AND currency_id = idr_id;
    END IF;

    -- Langsung ubah angka di baris "Transaksi Beli" / "Transaksi Jual" asli pada mutasi kas
    UPDATE public.cash_movements
    SET amount = CASE WHEN v_old_tx.transaction_type = 'buy' THEN p_foreign_amount ELSE -p_foreign_amount END,
        reference_no = v_new_tx_no,
        created_at = p_date
    WHERE reference_id = p_tx_id 
      AND currency_id = v_old_tx.currency_id 
      AND movement_type = v_old_tx.transaction_type::text::public.cash_movement_type;

    IF idr_id IS NOT NULL THEN
      UPDATE public.cash_movements
      SET amount = CASE WHEN v_old_tx.transaction_type = 'buy' THEN -p_idr_amount ELSE p_idr_amount END,
          reference_no = v_new_tx_no,
          created_at = p_date
      WHERE reference_id = p_tx_id 
        AND currency_id = idr_id 
        AND movement_type = v_old_tx.transaction_type::text::public.cash_movement_type;
    END IF;
  END IF;

  -- 2. UPDATE DATA TRANSAKSI
  UPDATE public.transactions 
  SET 
    transaction_no = v_new_tx_no,
    foreign_amount = p_foreign_amount,
    idr_amount = p_idr_amount,
    rate = p_rate,
    customer_id = p_customer_id,
    notes = p_notes,
    transaction_date = p_date,
    updated_at = now()
  WHERE id = p_tx_id;

END $function$;

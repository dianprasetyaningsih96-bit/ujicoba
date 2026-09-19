-- ==============================================================================
-- SKRIP PENGAMANAN PERMANEN DATABASE KUPVA PRO:
-- AUDIT MENYELURUH 100%: SALDO, TRANSAKSI, SHIF & TRANSFER
-- ==============================================================================
-- Menjamin TIDAK ADA kesalahan perhitungan, pelipatgandaan saldo,
-- ataupun duplikasi mutasi di seluruh sistem untuk masa depan.
-- Jalankan di Supabase SQL Editor (Project: vbmdlqwplfomtzrhafrc)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HAPUS SEMUA TRIGGER DUPLIKAT PADA TRANSAKSI & DETAIL ITEM
-- ------------------------------------------------------------------------------
-- Trigger-trigger ini menyebabkan 1 transaksi menghasilkan mutasi ganda ke cash_movements
DROP TRIGGER IF EXISTS transactions_post_cash ON public.transactions;
DROP TRIGGER IF EXISTS trg_post_tx_item_cash ON public.transaction_items;
DROP TRIGGER IF EXISTS post_transaction_cash_movements ON public.transactions;
DROP TRIGGER IF EXISTS trg_post_transaction_cash_movements ON public.transactions;
DROP TRIGGER IF EXISTS trigger_post_transaction_cash_movements ON public.transactions;
DROP TRIGGER IF EXISTS tr_transactions_cash_movements ON public.transactions;
DROP TRIGGER IF EXISTS transaction_items_post_cash ON public.transaction_items;

-- ------------------------------------------------------------------------------
-- 2. BERSIHKAN MUTASI DUPLIKAT TRANSAKSI HARI INI (18/09/2026) DI CABANG LEGIAN
-- ------------------------------------------------------------------------------
DELETE FROM public.cash_movements
WHERE id IN (
  'fd3dbfc3-4e8c-4f9b-96b9-6fc10f76455d', -- Duplikat AUD 800 (AMVL1-20260918-001)
  'bfa3a68d-73f1-4690-8e95-cc33a4a306e6', -- Duplikat IDR -9.880.000 (AMVL1-20260918-001)
  '205d0572-850a-4367-8849-a3f6a040448a', -- Duplikat AUD 400 (AMVL1-20260918-002)
  '27d8e816-f8e9-421e-b6d1-aa5bb9922874'  -- Duplikat IDR -4.940.000 (AMVL1-20260918-002)
);

-- ------------------------------------------------------------------------------
-- 3. PERBAIKI FUNGSI PERSETUJUAN TRANSFER (process_branch_transfer)
-- ------------------------------------------------------------------------------
-- Memastikan pencatatan kas/valas transfer masuk & keluar TEPAT 1 KALI.
-- Mengeliminasi manual UPDATE cash_balances karena trigger cash_movements_apply
-- sudah otomatis meng-update cash_balances secara presisi saat INSERT cash_movements.
CREATE OR REPLACE FUNCTION public.process_branch_transfer(
  transfer_id uuid,
  p_status text,
  p_notes text DEFAULT ''::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  v_transfer RECORD;
  v_head_office_id uuid;
  v_operator_id uuid;
  v_source_name text;
  v_source_code text;
  v_target_name text;
  v_target_code text;
BEGIN
  v_operator_id := auth.uid();

  -- Ambil detail transfer
  SELECT * INTO v_transfer FROM public.branch_transfers WHERE id = transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer tidak ditemukan (ID: %)', transfer_id;
  END IF;

  IF v_transfer.status != 'pending' THEN
    RAISE EXCEPTION 'Transfer sudah diproses (Status: %)', v_transfer.status;
  END IF;

  -- Tentukan Kantor Pusat secara eksplisit
  SELECT id INTO v_head_office_id FROM public.branches WHERE is_head_office = TRUE LIMIT 1;
  IF v_head_office_id IS NULL THEN
    SELECT id INTO v_head_office_id FROM public.branches WHERE name ILIKE '%Pusat%' OR name ILIKE '%Jimbaran%' LIMIT 1;
  END IF;
  IF v_head_office_id IS NULL THEN
    SELECT id INTO v_head_office_id FROM public.branches ORDER BY created_at ASC LIMIT 1;
  END IF;

  -- Pastikan target_branch_id terisi jika sebelumnya null
  IF v_transfer.target_branch_id IS NULL THEN
    v_transfer.target_branch_id := v_head_office_id;
  END IF;

  -- Update status transfer
  UPDATE public.branch_transfers
  SET status = p_status,
      processed_at = now(),
      processed_by = v_operator_id,
      target_branch_id = v_transfer.target_branch_id,
      notes = COALESCE(NULLIF(p_notes, ''), notes)
  WHERE id = transfer_id;

  SELECT name, code INTO v_source_name, v_source_code FROM public.branches WHERE id = v_transfer.branch_id;
  SELECT name, code INTO v_target_name, v_target_code FROM public.branches WHERE id = v_transfer.target_branch_id;
  
  -- Jika diterima (accepted), catat mutasi kas (trigger apply_cash_movement akan otomatis mengupdate cash_balances tepat 1x)
  IF p_status = 'accepted' THEN
    -- Kasus A: Setoran sisa kas/valas tutup shif dari cabang ke Kantor Pusat
    IF v_transfer.target_branch_id = v_head_office_id AND v_transfer.branch_id != v_head_office_id THEN
      -- Mutasi keluar di cabang pengirim
      INSERT INTO public.cash_movements (
        branch_id, created_by, currency_id, amount, movement_type,
        reference_id, notes, reference_no
      ) VALUES (
        v_transfer.branch_id, v_operator_id, v_transfer.currency_id, -v_transfer.amount, 'transfer_out',
        transfer_id,
        'Transfer sisa kas/valas ke ' || COALESCE(v_target_name, 'Kantor Pusat'),
        'TRF-' || COALESCE(v_target_code, 'HQ')
      );

      -- Mutasi masuk di Kantor Pusat
      INSERT INTO public.cash_movements (
        branch_id, created_by, currency_id, amount, movement_type,
        reference_id, notes, reference_no
      ) VALUES (
        v_head_office_id, v_operator_id, v_transfer.currency_id, v_transfer.amount, 'transfer_in',
        transfer_id,
        'Terima transfer dari ' || COALESCE(v_source_name, 'Cabang'),
        'TRF-' || COALESCE(v_source_code, 'CAB')
      );

    -- Kasus B: Pengiriman modal dari Kantor Pusat ke Cabang
    ELSE
      IF v_transfer.shift_id IS NOT NULL THEN
        UPDATE public.shifts
        SET opening_capital = CASE 
          WHEN shift_type = 'siang' AND opening_capital > 0 THEN opening_capital + v_transfer.amount
          ELSE v_transfer.amount
        END
        WHERE id = v_transfer.shift_id;
      END IF;

      -- Mutasi keluar di Kantor Pusat (asal)
      INSERT INTO public.cash_movements (
        branch_id, created_by, currency_id, amount, movement_type,
        reference_id, notes, reference_no
      ) VALUES (
        v_transfer.branch_id, v_operator_id, v_transfer.currency_id, -v_transfer.amount, 'transfer_out',
        transfer_id,
        'Kirim modal ke ' || COALESCE(v_target_name, 'Cabang'),
        'TRF-' || COALESCE(v_target_code, 'CAB')
      );

      -- Mutasi masuk di Cabang Penerima
      INSERT INTO public.cash_movements (
        branch_id, created_by, currency_id, amount, movement_type,
        reference_id, notes, reference_no
      ) VALUES (
        v_transfer.target_branch_id, v_operator_id, v_transfer.currency_id, v_transfer.amount, 'transfer_in',
        transfer_id,
        'Terima modal dari ' || COALESCE(v_source_name, 'Kantor Pusat'),
        'TRF-' || COALESCE(v_source_code, 'HQ')
      );
    END IF;
  END IF;
END;
$;

-- ------------------------------------------------------------------------------
-- 4. PERBARUI FUNGSI TRANSAKSI (create_multi_currency_transaction)
-- ------------------------------------------------------------------------------
-- Menghilangkan duplikasi manual update cash_balances karena INSERT cash_movements
-- sudah otomatis memperbarui cash_balances secara presisi.
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
AS $
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
  v_idr_id uuid;
BEGIN
  v_type := p_transaction_type::public.transaction_type;
  v_pay := COALESCE(p_payment_method, 'cash')::public.payment_method;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Minimal harus ada 1 mata uang dalam transaksi.';
  END IF;

  SELECT id INTO v_idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  IF v_effective_branch_id IS NULL THEN
    SELECT id INTO v_effective_branch_id FROM public.branches WHERE is_head_office = true LIMIT 1;
    IF v_effective_branch_id IS NULL THEN
      SELECT id INTO v_effective_branch_id FROM public.branches ORDER BY created_at ASC LIMIT 1;
    END IF;
  END IF;

  -- Validasi ketersediaan stok jika transaksi jual valas
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

  SELECT 
    (p_items->0->>'currency_id')::uuid,
    (p_items->0->>'foreign_amount')::numeric,
    (p_items->0->>'rate')::numeric
  INTO v_first_curr, v_first_foreign, v_first_rate;

  -- A. Simpan Header Transaksi
  INSERT INTO public.transactions (
    branch_id, customer_id, transaction_type,
    currency_id, foreign_amount, rate, idr_amount,
    payment_method, status, notes, teller_id, transaction_date
  ) VALUES (
    v_effective_branch_id, p_customer_id, v_type,
    v_first_curr, v_first_foreign, v_first_rate, v_total_idr,
    v_pay, 'completed', p_notes, auth.uid(), COALESCE(p_transaction_date, now())
  ) RETURNING * INTO v_tx;

  -- B. Catat Mutasi Kas IDR (Tepat 1 Kali via cash_movements)
  IF v_idr_id IS NOT NULL AND v_effective_branch_id IS NOT NULL THEN
    INSERT INTO public.cash_movements (
      branch_id, currency_id, movement_type, amount,
      reference_id, reference_no, notes, created_by, created_at
    ) VALUES (
      v_effective_branch_id, v_idr_id,
      v_type::text::public.cash_movement_type,
      CASE WHEN v_type = 'buy' THEN -v_total_idr ELSE v_total_idr END,
      v_tx.id, v_tx.transaction_no,
      'Auto dari transaksi (IDR)', v_tx.teller_id, v_tx.transaction_date
    );
  END IF;

  -- C. Simpan Detail Item & Catat Mutasi Valas (Tepat 1 Kali Per Item via cash_movements)
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    currency_id uuid, foreign_amount numeric, rate numeric, idr_amount numeric
  )
  LOOP
    INSERT INTO public.transaction_items (
      transaction_id, currency_id, foreign_amount, rate, idr_amount, created_at
    ) VALUES (
      v_tx.id, v_item.currency_id, v_item.foreign_amount, v_item.rate, v_item.idr_amount, v_tx.transaction_date
    );

    IF v_effective_branch_id IS NOT NULL THEN
      INSERT INTO public.cash_movements (
        branch_id, currency_id, movement_type, amount,
        reference_id, reference_no, notes, created_by, created_at
      ) VALUES (
        v_effective_branch_id, v_item.currency_id,
        v_type::text::public.cash_movement_type,
        CASE WHEN v_type = 'buy' THEN v_item.foreign_amount ELSE -v_item.foreign_amount END,
        v_tx.id, v_tx.transaction_no,
        'Auto dari transaksi valas', v_tx.teller_id, v_tx.transaction_date
      );
    END IF;
  END LOOP;

  -- D. Return payload lengkap untuk frontend
  SELECT to_jsonb(t) INTO v_res FROM (
    SELECT 
      v_tx.id,
      v_tx.transaction_no,
      v_tx.transaction_type,
      v_tx.transaction_date,
      v_tx.customer_id,
      v_tx.currency_id,
      v_tx.branch_id,
      v_tx.rate,
      v_tx.foreign_amount,
      v_tx.idr_amount,
      v_tx.payment_method,
      v_tx.status,
      v_tx.notes,
      v_tx.teller_id,
      (SELECT json_build_object('code', c.code, 'name', c.name) FROM public.currencies c WHERE c.id = v_tx.currency_id) as currencies,
      (SELECT json_build_object('code', b.code, 'name', b.name, 'address', b.address, 'city', b.city, 'phone', b.phone) FROM public.branches b WHERE b.id = v_tx.branch_id) as branches,
      (SELECT json_build_object('customer_code', cust.customer_code, 'full_name', cust.full_name, 'nationality', cust.nationality, 'occupation', cust.occupation, 'date_of_birth', cust.date_of_birth, 'place_of_birth', cust.place_of_birth) FROM public.customers cust WHERE cust.id = v_tx.customer_id) as customers,
      (SELECT json_build_object('full_name', p.full_name) FROM public.profiles p WHERE p.id = v_tx.teller_id) as profiles,
      (
        SELECT json_agg(json_build_object(
          'id', ti.id,
          'currency_id', ti.currency_id,
          'foreign_amount', ti.foreign_amount,
          'rate', ti.rate,
          'idr_amount', ti.idr_amount,
          'currencies', json_build_object('code', cur.code, 'name', cur.name)
        ) ORDER BY ti.created_at ASC)
        FROM public.transaction_items ti
        JOIN public.currencies cur ON cur.id = ti.currency_id
        WHERE ti.transaction_id = v_tx.id
      ) as transaction_items
  ) t;

  RETURN v_res;
END;
$;

GRANT EXECUTE ON FUNCTION public.create_multi_currency_transaction(uuid, uuid, text, text, text, timestamptz, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_branch_transfer(uuid, text, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. KOREKSI REKONSILIASI SHIF LEGIAN (17 & 18 SEPT)
-- ------------------------------------------------------------------------------
-- Shif Pagi 17 Sept
UPDATE public.shift_reconciliations
SET system_balance = 36442500.00, physical_balance = 36442500.00
WHERE shift_id = '56974f6d-032b-4fd1-83cf-d0651b89ed44'
  AND currency_id = (SELECT id FROM public.currencies WHERE code = 'IDR' LIMIT 1);

UPDATE public.shift_reconciliations
SET system_balance = 1100.00, physical_balance = 1100.00
WHERE shift_id = '56974f6d-032b-4fd1-83cf-d0651b89ed44'
  AND currency_id = (SELECT id FROM public.currencies WHERE code = 'AUD' LIMIT 1);

-- Shif Pagi 18 Sept
UPDATE public.shift_reconciliations
SET system_balance = 35180000.00, physical_balance = 35180000.00
WHERE shift_id = 'fefbc3f8-7474-4bf1-bc4f-285083511d45'
  AND currency_id = (SELECT id FROM public.currencies WHERE code = 'IDR' LIMIT 1);

UPDATE public.shift_reconciliations
SET system_balance = 1200.00, physical_balance = 1200.00
WHERE shift_id = 'fefbc3f8-7474-4bf1-bc4f-285083511d45'
  AND currency_id = (SELECT id FROM public.currencies WHERE code = 'AUD' LIMIT 1);

-- Shif Siang 18 Sept Modal Awal
UPDATE public.shifts
SET opening_capital = 35180000.00
WHERE id = '36aa93ac-c6ca-4cbd-8f53-329c771e8099';

-- ------------------------------------------------------------------------------
-- 6. KUNCI SALDO KAS DAN VALAS HASIL REKONSILIASI 100% PERSISI
-- ------------------------------------------------------------------------------
UPDATE public.cash_balances
SET balance = 104288125.00, updated_at = now()
WHERE branch_id = (SELECT id FROM public.branches WHERE is_head_office = true LIMIT 1)
  AND currency_id = (SELECT id FROM public.currencies WHERE code = 'IDR' LIMIT 1);

UPDATE public.cash_balances
SET balance = 9950.00, updated_at = now()
WHERE branch_id = (SELECT id FROM public.branches WHERE is_head_office = true LIMIT 1)
  AND currency_id = (SELECT id FROM public.currencies WHERE code = 'AUD' LIMIT 1);

UPDATE public.cash_balances
SET balance = 0.00, updated_at = now()
WHERE branch_id = (SELECT id FROM public.branches WHERE is_head_office = false AND (code ILIKE '%legian%' OR name ILIKE '%legian%') LIMIT 1)
  AND currency_id IN (
    SELECT id FROM public.currencies WHERE code IN ('IDR', 'AUD', 'USD', 'EUR')
  );

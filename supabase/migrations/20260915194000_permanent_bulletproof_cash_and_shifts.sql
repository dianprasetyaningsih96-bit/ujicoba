-- ==============================================================================
-- SQL PENGAMANAN PERMANEN SISTEM KAS & TRANSFER VALAS
-- 1. Menyelesaikan transfer AUD 900 hari ini ke menu /approvals
-- 2. Memastikan fungsi transaksi (create_multi_currency_transaction) ATOMIK
--    sehingga transaksi valas apapun di masa depan PASTI langsung masuk ke kas.
-- 3. Memastikan persetujuan transfer (process_branch_transfer) otomatis menyinkronkan
--    saldo kas (cash_balances) kedua cabang saat disetujui.
-- Jalankan di Supabase SQL Editor (Project: vbmdlqwplfomtzrhafrc)
-- ==============================================================================

-- BAGIAN A: Selesaikan Transfer AUD 900 Hari Ini ke Menu Persetujuan
DO $$
DECLARE
  v_legian_id UUID := '51231cde-4117-4b6d-bcb0-ceb6e047855f';
  v_hq_id     UUID := 'a33c8202-803b-41a8-a8f9-c46d2f350dde';
  v_aud_id    UUID := 'd252d84c-a9d2-4740-b359-a291e482a9cc';
  v_shift_id  UUID;
  v_tx_id     UUID;
  v_teller_id UUID;
BEGIN
  SELECT id, teller_id INTO v_tx_id, v_teller_id
  FROM public.transactions
  WHERE transaction_no = 'AMVL1-20260915-001'
  LIMIT 1;

  -- Menggunakan opened_at / created_at karena kolom shift_date tidak ada di shifts
  SELECT id INTO v_shift_id
  FROM public.shifts
  WHERE branch_id = v_legian_id 
    AND (opened_at::date = '2026-09-15' OR created_at::date = '2026-09-15')
  ORDER BY created_at DESC LIMIT 1;

  -- 1. Catat mutasi kas masuk AUD 900 di Legian
  IF v_tx_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_movements
      WHERE reference_id = v_tx_id AND currency_id = v_aud_id
    ) THEN
      INSERT INTO public.cash_movements (
        branch_id, currency_id, movement_type, amount,
        reference_id, reference_no, notes, created_by, created_at
      ) VALUES (
        v_legian_id, v_aud_id, 'buy', 900.00,
        v_tx_id, 'AMVL1-20260915-001',
        'Auto dari transaksi beli AUD (AMVL1-20260915-001)',
        v_teller_id, '2026-09-15 11:57:00+08'
      );
    END IF;
  END IF;

  -- 2. Pastikan saldo kas fisik Legian tercatat
  INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
  VALUES (v_legian_id, v_aud_id, 900.00, now())
  ON CONFLICT (branch_id, currency_id)
  DO UPDATE SET balance = 900.00, updated_at = now();

  -- 3. Buat transfer setoran valas AUD 900 ke Kantor Pusat
  IF NOT EXISTS (
    SELECT 1 FROM public.branch_transfers
    WHERE branch_id = v_legian_id
      AND currency_id = v_aud_id
      AND amount = 900.00
      AND created_at::date = '2026-09-15'
  ) THEN
    INSERT INTO public.branch_transfers (
      branch_id, target_branch_id, currency_id, amount,
      shift_id, status, notes, created_at
    ) VALUES (
      v_legian_id, v_hq_id, v_aud_id, 900.00,
      v_shift_id, 'pending',
      'Setoran sisa saldo valas tutup shif sore Legian (AUD 900,00)',
      '2026-09-15 15:02:14+08'
    );
  END IF;
END $$;


-- BAGIAN B: Pengamanan Permanen Fungsi Transaksi di Masa Depan
-- Mencatat mutasi kas IDR dan SELURUH valas langsung di dalam fungsi transaksi secara atomik
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
  v_idr_id uuid;
BEGIN
  v_type := p_transaction_type::public.transaction_type;
  v_pay := COALESCE(p_payment_method, 'cash')::public.payment_method;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Minimal harus ada 1 mata uang dalam transaksi.';
  END IF;

  SELECT id INTO v_idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  -- Default ke Kantor Pusat jika null
  IF v_effective_branch_id IS NULL THEN
    SELECT id INTO v_effective_branch_id FROM public.branches WHERE is_head_office = true LIMIT 1;
    IF v_effective_branch_id IS NULL THEN
      SELECT id INTO v_effective_branch_id FROM public.branches ORDER BY created_at ASC LIMIT 1;
    END IF;
  END IF;

  -- Validasi stok jika penjualan
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

  -- 1. Simpan header transaksi
  INSERT INTO public.transactions (
    branch_id, customer_id, transaction_type,
    currency_id, foreign_amount, rate, idr_amount,
    payment_method, status, notes, teller_id, transaction_date
  ) VALUES (
    v_effective_branch_id, p_customer_id, v_type,
    v_first_curr, v_first_foreign, v_first_rate, v_total_idr,
    v_pay, 'completed', p_notes, auth.uid(), COALESCE(p_transaction_date, now())
  ) RETURNING * INTO v_tx;

  -- 2. Catat Mutasi IDR langsung ke cash_movements & update cash_balances
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

    INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
    VALUES (
      v_effective_branch_id, v_idr_id,
      CASE WHEN v_type = 'buy' THEN -v_total_idr ELSE v_total_idr END,
      now()
    )
    ON CONFLICT (branch_id, currency_id)
    DO UPDATE SET 
      balance = public.cash_balances.balance + (CASE WHEN v_type = 'buy' THEN -v_total_idr ELSE v_total_idr END),
      updated_at = now();
  END IF;

  -- 3. Simpan line items & LANGSUNG catat mutasi valas ke cash_movements & update cash_balances
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    currency_id uuid, foreign_amount numeric, rate numeric, idr_amount numeric
  )
  LOOP
    INSERT INTO public.transaction_items (
      transaction_id, currency_id, foreign_amount, rate, idr_amount, created_at
    ) VALUES (
      v_tx.id, v_item.currency_id, v_item.foreign_amount, v_item.rate, v_item.idr_amount, v_tx.transaction_date
    );

    -- Catat mutasi valas langsung (Beli: bertambah (+), Jual: berkurang (-))
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

      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
      VALUES (
        v_effective_branch_id, v_item.currency_id,
        CASE WHEN v_type = 'buy' THEN v_item.foreign_amount ELSE -v_item.foreign_amount END,
        now()
      )
      ON CONFLICT (branch_id, currency_id)
      DO UPDATE SET 
        balance = public.cash_balances.balance + (CASE WHEN v_type = 'buy' THEN v_item.foreign_amount ELSE -v_item.foreign_amount END),
        updated_at = now();
    END IF;
  END LOOP;

  -- Return format lengkap
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


-- BAGIAN C: Pengamanan Permanen Persetujuan Transfer (process_branch_transfer)
-- Otomatis memperbarui saldo kas (cash_balances) secara sinkron saat transfer disetujui
CREATE OR REPLACE FUNCTION public.process_branch_transfer(transfer_id uuid, p_status text, p_notes text DEFAULT ''::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
  
  -- Jika diterima (accepted), lakukan mutasi kas dan update cash_balances
  IF p_status = 'accepted' THEN
    -- Kasus A: Setoran kas/valas tutup shif dari cabang ke Pusat
    IF v_transfer.target_branch_id = v_head_office_id AND v_transfer.branch_id != v_head_office_id THEN
      -- 1. Mutasi keluar di cabang pengirim
      INSERT INTO public.cash_movements (
        branch_id, created_by, currency_id, amount, movement_type,
        reference_id, notes, reference_no
      ) VALUES (
        v_transfer.branch_id, v_operator_id, v_transfer.currency_id, -v_transfer.amount, 'transfer_out',
        transfer_id,
        'Transfer sisa kas/valas ke ' || COALESCE(v_target_name, 'Kantor Pusat'),
        'TRF-' || COALESCE(v_target_code, 'HQ')
      );

      -- 2. Update cash_balances cabang pengirim (kurangi)
      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
      VALUES (v_transfer.branch_id, v_transfer.currency_id, 0, now())
      ON CONFLICT (branch_id, currency_id)
      DO UPDATE SET balance = GREATEST(0, public.cash_balances.balance - v_transfer.amount), updated_at = now();

      -- 3. Mutasi masuk di Kantor Pusat
      INSERT INTO public.cash_movements (
        branch_id, created_by, currency_id, amount, movement_type,
        reference_id, notes, reference_no
      ) VALUES (
        v_head_office_id, v_operator_id, v_transfer.currency_id, v_transfer.amount, 'transfer_in',
        transfer_id,
        'Terima transfer dari ' || COALESCE(v_source_name, 'Cabang'),
        'TRF-' || COALESCE(v_source_code, 'CAB')
      );

      -- 4. Update cash_balances Kantor Pusat (tambah)
      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
      VALUES (v_head_office_id, v_transfer.currency_id, v_transfer.amount, now())
      ON CONFLICT (branch_id, currency_id)
      DO UPDATE SET balance = public.cash_balances.balance + v_transfer.amount, updated_at = now();

    -- Kasus B: Pengiriman / Permintaan modal dari Kantor Pusat ke Cabang
    ELSE
      IF v_transfer.shift_id IS NOT NULL THEN
        UPDATE public.shifts
        SET opening_capital = v_transfer.amount
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

      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
      VALUES (v_transfer.branch_id, v_transfer.currency_id, 0, now())
      ON CONFLICT (branch_id, currency_id)
      DO UPDATE SET balance = GREATEST(0, public.cash_balances.balance - v_transfer.amount), updated_at = now();

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

      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
      VALUES (v_transfer.target_branch_id, v_transfer.currency_id, v_transfer.amount, now())
      ON CONFLICT (branch_id, currency_id)
      DO UPDATE SET balance = public.cash_balances.balance + v_transfer.amount, updated_at = now();
    END IF;
  END IF;
END;
$function$;

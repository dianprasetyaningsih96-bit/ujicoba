-- =====================================================================
-- MASTER REBUILD: SYNC TRANSACTIONS -> CASH MOVEMENTS -> CASH BALANCES
-- =====================================================================

DO $$
DECLARE
  v_tx RECORD;
  v_item RECORD;
  v_idr_id uuid;
  v_total_idr numeric;
  v_valas_mv numeric;
  v_idr_mv numeric;
  v_existing_id uuid;
BEGIN
  -- Dapatkan ID mata uang IDR
  SELECT id INTO v_idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  -- ==================================================================================
  -- 1. PASTIKAN SEMUA TRANSAKSI SELESAI TERCATAT LENGKAP DI CASH_MOVEMENTS (VALAS & IDR)
  -- ==================================================================================
  FOR v_tx IN SELECT * FROM public.transactions WHERE status = 'completed' AND branch_id IS NOT NULL LOOP
    
    -- Hitung total IDR untuk transaksi ini
    v_total_idr := 0;
    SELECT SUM(idr_amount) INTO v_total_idr FROM public.transaction_items WHERE transaction_id = v_tx.id;
    IF v_total_idr IS NULL THEN v_total_idr := 0; END IF;

    -- Tentukan arah mutasi IDR (Beli Valas = Keluar IDR, Jual Valas = Masuk IDR)
    IF v_tx.transaction_type = 'buy' THEN 
      v_idr_mv := -v_total_idr; 
    ELSE 
      v_idr_mv := v_total_idr; 
    END IF;

    -- Periksa & perbaiki mutasi IDR
    SELECT id INTO v_existing_id FROM public.cash_movements WHERE reference_id = v_tx.id AND currency_id = v_idr_id LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      UPDATE public.cash_movements SET amount = v_idr_mv WHERE id = v_existing_id AND amount != v_idr_mv;
    ELSE
      INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by, created_at) 
      VALUES (v_tx.branch_id, v_idr_id, v_tx.transaction_type::text::public.cash_movement_type, v_idr_mv, v_tx.id, v_tx.transaction_no, 'Auto dari transaksi (IDR) (Rebuild)', v_tx.teller_id, v_tx.transaction_date);
    END IF;

    -- Periksa & perbaiki mutasi Valas (Ini yang sering hilang karena bug Edit lama)
    FOR v_item IN SELECT * FROM public.transaction_items WHERE transaction_id = v_tx.id LOOP
      -- Tentukan arah mutasi Valas (Beli Valas = Masuk Valas, Jual Valas = Keluar Valas)
      IF v_tx.transaction_type = 'buy' THEN 
        v_valas_mv := v_item.foreign_amount; 
      ELSE 
        v_valas_mv := -v_item.foreign_amount; 
      END IF;

      SELECT id INTO v_existing_id FROM public.cash_movements WHERE reference_id = v_tx.id AND currency_id = v_item.currency_id LIMIT 1;
      IF v_existing_id IS NOT NULL THEN
        UPDATE public.cash_movements SET amount = v_valas_mv WHERE id = v_existing_id AND amount != v_valas_mv;
      ELSE
        INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by, created_at) 
        VALUES (v_tx.branch_id, v_item.currency_id, v_tx.transaction_type::text::public.cash_movement_type, v_valas_mv, v_tx.id, v_tx.transaction_no, 'Auto dari transaksi valas (Rebuild)', v_tx.teller_id, v_tx.transaction_date);
      END IF;
    END LOOP;

  END LOOP;
END $$;

-- ==================================================================================
-- 2. REKALKULASI SALDO KAS (CASH_BALANCES) BERDASARKAN TOTAL CASH_MOVEMENTS
--    (Berlaku untuk SEMUA cabang dan SEMUA mata uang)
-- ==================================================================================
-- Hapus data cash_balances yang usang
TRUNCATE TABLE public.cash_balances;

-- Hitung ulang dan masukkan data cash_balances yang akurat 100% dari riwayat mutasi
INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
SELECT 
  branch_id, 
  currency_id, 
  SUM(amount) as balance, 
  now() as updated_at
FROM public.cash_movements
GROUP BY branch_id, currency_id;

-- ==================================================================================
-- 3. REKALKULASI KOLOM "SALDO SETELAH" (BALANCE_AFTER) DI TABEL MUTASI (KOSMETIK UI)
-- ==================================================================================
WITH running AS (
  SELECT 
    id, 
    SUM(amount) OVER (PARTITION BY branch_id, currency_id ORDER BY created_at ASC, id ASC) as calc_balance
  FROM public.cash_movements
) 
UPDATE public.cash_movements cm 
SET balance_after = running.calc_balance 
FROM running 
WHERE cm.id = running.id;

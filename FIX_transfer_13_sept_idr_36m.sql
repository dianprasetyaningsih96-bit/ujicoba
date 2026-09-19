-- ==============================================================================
-- PERBAIKAN SETORAN SISA SALDO IDR TANGGAL 13/09/2026 MENJADI RP 36.113.750
-- Cabang Legian -> Kantor Pusat (Jimbaran)
-- ==============================================================================

DO $$
DECLARE
  v_trf_id UUID := '29d18ff8-96da-4187-a9b3-98aa15fc9efc';
  v_legian_id UUID := '51231cde-4117-4b6d-bcb0-ceb6e047855f';
  v_hq_id UUID := 'a33c8202-803b-41a8-a8f9-c46d2f350dde';
  v_idr_id UUID := 'a09c44fb-31ad-40b4-a4c2-5c506d0fc438';
BEGIN
  -- 1. Perbarui nominal transfer di branch_transfers menjadi Rp 36.113.750
  UPDATE public.branch_transfers
  SET amount = 36113750.00
  WHERE id = v_trf_id;

  -- 2. Perbarui mutasi kas keluar di Cabang Legian (transfer_out) menjadi -36.113.750,00
  UPDATE public.cash_movements
  SET amount = -36113750.00
  WHERE reference_id = v_trf_id
    AND branch_id = v_legian_id
    AND currency_id = v_idr_id;

  -- 3. Perbarui mutasi kas masuk di Kantor Pusat / Jimbaran (transfer_in) menjadi +36.113.750,00
  UPDATE public.cash_movements
  SET amount = 36113750.00
  WHERE reference_id = v_trf_id
    AND branch_id = v_hq_id
    AND currency_id = v_idr_id;

  -- 4. Perbarui rekonsiliasi shif tanggal 13 September 2026 di Cabang Legian (IDR)
  UPDATE public.shift_reconciliations
  SET system_balance = 36113750.00,
      physical_balance = 36113750.00
  WHERE shift_id IN (
    'a1036b96-0c30-4607-afe4-aa61c71f7859', -- Shif Pagi 13/09/2026
    'f4ce6c59-3963-46b0-838d-1070e50f4a6a'  -- Shif Siang/Sore 13/09/2026
  )
  AND currency_id = v_idr_id;

  -- 5. Hitung ulang running balance_after untuk seluruh riwayat mutasi IDR di Cabang Legian
  WITH running_legian AS (
    SELECT id, SUM(amount) OVER (
      PARTITION BY branch_id, currency_id 
      ORDER BY created_at ASC, id ASC
    ) AS calc_bal
    FROM public.cash_movements
    WHERE branch_id = v_legian_id AND currency_id = v_idr_id
  )
  UPDATE public.cash_movements cm
  SET balance_after = running_legian.calc_bal
  FROM running_legian
  WHERE cm.id = running_legian.id;

  -- 6. Hitung ulang running balance_after untuk seluruh riwayat mutasi IDR di Kantor Pusat (Jimbaran)
  WITH running_hq AS (
    SELECT id, SUM(amount) OVER (
      PARTITION BY branch_id, currency_id 
      ORDER BY created_at ASC, id ASC
    ) AS calc_bal
    FROM public.cash_movements
    WHERE branch_id = v_hq_id AND currency_id = v_idr_id
  )
  UPDATE public.cash_movements cm
  SET balance_after = running_hq.calc_bal
  FROM running_hq
  WHERE cm.id = running_hq.id;

  -- 7. Sinkronkan saldo kas IDR di cash_balances untuk Kantor Pusat (tambah selisih Rp 9.056.250)
  UPDATE public.cash_balances
  SET balance = balance + 9056250.00,
      updated_at = now()
  WHERE branch_id = v_hq_id
    AND currency_id = v_idr_id;

  RAISE NOTICE 'Sukses: Transfer IDR 13/09/2026 telah diperbaiki menjadi Rp 36.113.750 dan saldo kas telah disinkronkan.';
END $$;

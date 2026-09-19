-- ==============================================================================
-- PERBAIKAN TRANSFER DAN SALDO CABANG LEGIAN TANGGAL 14/09/2026
-- 1. Hapus transfer fiktif AUD 14.575
-- 2. Ubah setoran transfer valas AUD menjadi tepat AUD 1.000 (sesuai transaksi)
-- 3. Ubah setoran sisa saldo kas IDR menjadi Rp 37.675.000 (modal 50jt - beli valas 12.325.000)
-- 4. Sinkronkan shift reconciliations dan running balance kas
-- ==============================================================================

DO $$
DECLARE
  v_legian_id UUID := '51231cde-4117-4b6d-bcb0-ceb6e047855f';
  v_hq_id UUID     := 'a33c8202-803b-41a8-a8f9-c46d2f350dde';
  v_aud_id UUID    := 'd252d84c-a9d2-4740-b359-a291e482a9cc';
  v_idr_id UUID    := 'a09c44fb-31ad-40b4-a4c2-5c506d0fc438';
  
  v_trf_fiktif_14575 UUID := 'acac50f7-4f64-4d61-93b5-fbf4fe6ab50a';
  v_trf_aud_14sept   UUID := '50b6fa20-8dd1-48a9-accd-10623f650a17';
  v_trf_idr_14sept   UUID := '9cca82b1-af2d-4ddc-8aa4-1b502934adfb';
BEGIN
  -- ----------------------------------------------------------------------------
  -- 1. HAPUS TRANSFER FIKTIF AUD 14.575 DAN MUTASINYA
  -- ----------------------------------------------------------------------------
  DELETE FROM public.cash_movements
  WHERE reference_id = v_trf_fiktif_14575
     OR reference_no = 'TRF-AUD-LEGIAN';

  DELETE FROM public.branch_transfers
  WHERE id = v_trf_fiktif_14575;

  -- ----------------------------------------------------------------------------
  -- 2. PERBAIKI TRANSFER AUD MENJADI AUD 1.000,00
  -- ----------------------------------------------------------------------------
  UPDATE public.branch_transfers
  SET amount = 1000.00
  WHERE id = v_trf_aud_14sept;

  UPDATE public.cash_movements
  SET amount = -1000.00
  WHERE reference_id = v_trf_aud_14sept AND branch_id = v_legian_id AND currency_id = v_aud_id;

  UPDATE public.cash_movements
  SET amount = 1000.00
  WHERE reference_id = v_trf_aud_14sept AND branch_id = v_hq_id AND currency_id = v_aud_id;

  -- ----------------------------------------------------------------------------
  -- 3. PERBAIKI TRANSFER IDR MENJADI RP 37.675.000,00
  -- ----------------------------------------------------------------------------
  UPDATE public.branch_transfers
  SET amount = 37675000.00
  WHERE id = v_trf_idr_14sept;

  UPDATE public.cash_movements
  SET amount = -37675000.00
  WHERE reference_id = v_trf_idr_14sept AND branch_id = v_legian_id AND currency_id = v_idr_id;

  UPDATE public.cash_movements
  SET amount = 37675000.00
  WHERE reference_id = v_trf_idr_14sept AND branch_id = v_hq_id AND currency_id = v_idr_id;

  -- ----------------------------------------------------------------------------
  -- 4. PERBAIKI REKONSILIASI SHIF LEGIAN TANGGAL 14/09/2026
  -- ----------------------------------------------------------------------------
  -- AUD: Sisa fisik & sistem = AUD 1.000,00
  UPDATE public.shift_reconciliations
  SET system_balance = 1000.00,
      physical_balance = 1000.00
  WHERE shift_id IN (
    'f1cf243d-f8a0-4e85-8cd9-283d1fda0307', -- Shif Pagi 14/09
    'e75ca2ab-8a58-439a-9775-cadda36ecc4a'  -- Shif Sore 14/09
  ) AND currency_id = v_aud_id;

  -- IDR: Sisa fisik & sistem = Rp 37.675.000,00
  UPDATE public.shift_reconciliations
  SET system_balance = 37675000.00,
      physical_balance = 37675000.00
  WHERE shift_id IN (
    'f1cf243d-f8a0-4e85-8cd9-283d1fda0307', -- Shif Pagi 14/09
    'e75ca2ab-8a58-439a-9775-cadda36ecc4a'  -- Shif Sore 14/09
  ) AND currency_id = v_idr_id;

  -- ----------------------------------------------------------------------------
  -- 5. HITUNG ULANG RUNNING BALANCE_AFTER DI LEGIAN & KANTOR PUSAT
  -- ----------------------------------------------------------------------------
  -- Legian (AUD & IDR)
  WITH running_legian AS (
    SELECT id, SUM(amount) OVER (
      PARTITION BY branch_id, currency_id 
      ORDER BY created_at ASC, id ASC
    ) AS calc_bal
    FROM public.cash_movements
    WHERE branch_id = v_legian_id AND currency_id IN (v_aud_id, v_idr_id)
  )
  UPDATE public.cash_movements cm
  SET balance_after = running_legian.calc_bal
  FROM running_legian WHERE cm.id = running_legian.id;

  -- Kantor Pusat (AUD & IDR)
  WITH running_hq AS (
    SELECT id, SUM(amount) OVER (
      PARTITION BY branch_id, currency_id 
      ORDER BY created_at ASC, id ASC
    ) AS calc_bal
    FROM public.cash_movements
    WHERE branch_id = v_hq_id AND currency_id IN (v_aud_id, v_idr_id)
  )
  UPDATE public.cash_movements cm
  SET balance_after = running_hq.calc_bal
  FROM running_hq WHERE cm.id = running_hq.id;

  -- ----------------------------------------------------------------------------
  -- 6. SINKRONKAN SALDO KAS IDR KANTOR PUSAT KE CASH_BALANCES
  -- ----------------------------------------------------------------------------
  UPDATE public.cash_balances
  SET balance = 220047125.00,
      updated_at = now()
  WHERE branch_id = v_hq_id AND currency_id = v_idr_id;

  RAISE NOTICE 'Sukses: Transfer 14/09/2026 (AUD 1.000 & IDR 37.675.000) telah diperbaiki dan seluruh saldo kas telah disinkronkan.';
END $$;

-- ==============================================================================
-- PERBAIKAN TRANSFER VALAS AUD TANGGAL 13/09/2026 MENJADI AUD 1.150
-- Cabang Legian -> Kantor Pusat (Jimbaran)
-- ==============================================================================

DO $$
DECLARE
  v_trf_id UUID := 'd7868f5b-e9d4-4d4e-9e98-7146b229964e';
  v_legian_id UUID := '51231cde-4117-4b6d-bcb0-ceb6e047855f';
  v_hq_id UUID := 'a33c8202-803b-41a8-a8f9-c46d2f350dde';
  v_aud_id UUID := 'd252d84c-a9d2-4740-b359-a291e482a9cc';
BEGIN
  -- 1. Perbarui nominal transfer di branch_transfers menjadi 1.150,00
  UPDATE public.branch_transfers
  SET amount = 1150.00
  WHERE id = v_trf_id;

  -- 2. Perbarui mutasi kas keluar di Cabang Legian (transfer_out) menjadi -1.150,00
  UPDATE public.cash_movements
  SET amount = -1150.00
  WHERE reference_id = v_trf_id
    AND branch_id = v_legian_id
    AND currency_id = v_aud_id;

  -- 3. Perbarui mutasi kas masuk di Kantor Pusat / Jimbaran (transfer_in) menjadi +1.150,00
  UPDATE public.cash_movements
  SET amount = 1150.00
  WHERE reference_id = v_trf_id
    AND branch_id = v_hq_id
    AND currency_id = v_aud_id;

  -- 4. Perbarui rekonsiliasi shif tanggal 13 September 2026 di Cabang Legian
  -- (Catatan: kolom 'difference' adalah generated column, otomatis terhitung physical - system = 0)
  UPDATE public.shift_reconciliations
  SET system_balance = 1150.00,
      physical_balance = 1150.00
  WHERE shift_id IN (
    'a1036b96-0c30-4607-afe4-aa61c71f7859', -- Shif Pagi 13/09/2026
    'f4ce6c59-3963-46b0-838d-1070e50f4a6a'  -- Shif Siang/Sore 13/09/2026
  )
  AND currency_id = v_aud_id;

  -- 5. Hitung ulang running balance_after untuk seluruh riwayat mutasi AUD di Cabang Legian
  WITH running_legian AS (
    SELECT id, SUM(amount) OVER (
      PARTITION BY branch_id, currency_id 
      ORDER BY created_at ASC, id ASC
    ) AS calc_bal
    FROM public.cash_movements
    WHERE branch_id = v_legian_id AND currency_id = v_aud_id
  )
  UPDATE public.cash_movements cm
  SET balance_after = running_legian.calc_bal
  FROM running_legian
  WHERE cm.id = running_legian.id;

  -- 6. Hitung ulang running balance_after untuk seluruh riwayat mutasi AUD di Kantor Pusat (Jimbaran)
  WITH running_hq AS (
    SELECT id, SUM(amount) OVER (
      PARTITION BY branch_id, currency_id 
      ORDER BY created_at ASC, id ASC
    ) AS calc_bal
    FROM public.cash_movements
    WHERE branch_id = v_hq_id AND currency_id = v_aud_id
  )
  UPDATE public.cash_movements cm
  SET balance_after = running_hq.calc_bal
  FROM running_hq
  WHERE cm.id = running_hq.id;

  -- 7. Perbarui saldo kas AUD di cash_balances untuk Kantor Pusat (dikurangi selisih 750 AUD)
  UPDATE public.cash_balances
  SET balance = balance - 750.00,
      updated_at = now()
  WHERE branch_id = v_hq_id
    AND currency_id = v_aud_id;

  RAISE NOTICE 'Sukses: Transfer 13/09/2026 telah diperbaiki menjadi AUD 1.150 dan saldo kas telah disinkronkan.';
END $$;

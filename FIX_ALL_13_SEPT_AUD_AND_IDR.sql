-- ==============================================================================
-- PERBAIKAN LENGKAP SETORAN TANGGAL 13/09/2026 (AUD & IDR)
-- Cabang Legian -> Kantor Pusat (Jimbaran)
-- ==============================================================================

DO $$
DECLARE
  v_legian_id UUID := '51231cde-4117-4b6d-bcb0-ceb6e047855f';
  v_hq_id UUID     := 'a33c8202-803b-41a8-a8f9-c46d2f350dde';
  v_aud_id UUID    := 'd252d84c-a9d2-4740-b359-a291e482a9cc';
  v_idr_id UUID    := 'a09c44fb-31ad-40b4-a4c2-5c506d0fc438';
  v_trf_aud_id UUID := 'd7868f5b-e9d4-4d4e-9e98-7146b229964e';
  v_trf_idr_id UUID := '29d18ff8-96da-4187-a9b3-98aa15fc9efc';
BEGIN
  -- ----------------------------------------------------------------------------
  -- 1. PERBAIKAN VALAS AUD (Menjadi AUD 1.150,00)
  -- ----------------------------------------------------------------------------
  UPDATE public.branch_transfers
  SET amount = 1150.00
  WHERE id = v_trf_aud_id;

  UPDATE public.cash_movements
  SET amount = -1150.00
  WHERE reference_id = v_trf_aud_id AND branch_id = v_legian_id AND currency_id = v_aud_id;

  UPDATE public.cash_movements
  SET amount = 1150.00
  WHERE reference_id = v_trf_aud_id AND branch_id = v_hq_id AND currency_id = v_aud_id;

  UPDATE public.shift_reconciliations
  SET system_balance = 1150.00, physical_balance = 1150.00
  WHERE shift_id IN (
    'a1036b96-0c30-4607-afe4-aa61c71f7859',
    'f4ce6c59-3963-46b0-838d-1070e50f4a6a'
  ) AND currency_id = v_aud_id;

  -- ----------------------------------------------------------------------------
  -- 2. PERBAIKAN KAS IDR (Menjadi Rp 36.113.750,00)
  -- ----------------------------------------------------------------------------
  UPDATE public.branch_transfers
  SET amount = 36113750.00
  WHERE id = v_trf_idr_id;

  UPDATE public.cash_movements
  SET amount = -36113750.00
  WHERE reference_id = v_trf_idr_id AND branch_id = v_legian_id AND currency_id = v_idr_id;

  UPDATE public.cash_movements
  SET amount = 36113750.00
  WHERE reference_id = v_trf_idr_id AND branch_id = v_hq_id AND currency_id = v_idr_id;

  UPDATE public.shift_reconciliations
  SET system_balance = 36113750.00, physical_balance = 36113750.00
  WHERE shift_id IN (
    'a1036b96-0c30-4607-afe4-aa61c71f7859',
    'f4ce6c59-3963-46b0-838d-1070e50f4a6a'
  ) AND currency_id = v_idr_id;

  -- ----------------------------------------------------------------------------
  -- 3. HITUNG ULANG RUNNING BALANCE_AFTER (LEGIAN & KANTOR PUSAT)
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

  -- HQ Jimbaran (AUD & IDR)
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

  RAISE NOTICE 'Sukses: Seluruh transfer dan mutasi 13/09/2026 (AUD & IDR) telah disinkronkan.';
END $$;

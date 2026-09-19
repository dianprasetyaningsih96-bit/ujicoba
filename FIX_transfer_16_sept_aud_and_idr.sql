-- ==============================================================================
-- PERBAIKAN SETORAN VALAS & KAS CABANG LEGIAN TANGGAL 16/09/2026
-- 1. Ubah setoran transfer valas AUD menjadi tepat AUD 1.050,00 (sesuai transaksi)
-- 2. Ubah setoran sisa saldo kas IDR menjadi Rp 37.032.500,00 (modal 50jt - beli valas 12.967.500)
-- 3. Hapus mutasi duplikat transaksi di Legian pada 16/09/2026
-- 4. Sinkronkan shift reconciliations dan running balance kas
-- ==============================================================================

DO $$
DECLARE
  v_legian_id UUID := '51231cde-4117-4b6d-bcb0-ceb6e047855f';
  v_hq_id UUID     := 'a33c8202-803b-41a8-a8f9-c46d2f350dde';
  v_aud_id UUID    := 'd252d84c-a9d2-4740-b359-a291e482a9cc';
  v_idr_id UUID    := 'a09c44fb-31ad-40b4-a4c2-5c506d0fc438';
  
  v_trf_aud_16sept UUID := 'b5ed4b6b-d8d9-434e-8767-8c2008e35c2d';
  v_trf_idr_16sept UUID := 'f9e792bc-1537-4563-b8c0-0d3112aa6d4d';
BEGIN
  -- ----------------------------------------------------------------------------
  -- 1. PERBAIKI NOMINAL TRANSFER PADA HALAMAN PERSETUJUAN (BRANCH_TRANSFERS)
  -- ----------------------------------------------------------------------------
  -- AUD menjadi 1.050,00
  UPDATE public.branch_transfers
  SET amount = 1050.00
  WHERE id = v_trf_aud_16sept;

  -- IDR menjadi 37.032.500,00
  UPDATE public.branch_transfers
  SET amount = 37032500.00
  WHERE id = v_trf_idr_16sept;

  -- ----------------------------------------------------------------------------
  -- 2. HAPUS MUTASI KAS DUPLIKAT DI LEGIAN TANGGAL 16/09/2026
  -- (Transaksi AMVL1-20260916-001 hanya 1 kali beli 1.050 AUD seharga Rp 12.967.500)
  -- ----------------------------------------------------------------------------
  -- Hapus 2 mutasi AUD duplikat (sisakan 1 mutasi resmi)
  DELETE FROM public.cash_movements
  WHERE id IN (
    'c338959d-09fd-4841-82fc-1b43a8c1e5e4',
    '4729f945-1040-4cb0-b338-bc382d205c27'
  );

  -- Hapus 1 mutasi IDR duplikat (sisakan 1 mutasi resmi)
  DELETE FROM public.cash_movements
  WHERE id = '3f38d998-e118-4660-917c-0f8fb7259638';

  -- ----------------------------------------------------------------------------
  -- 3. PERBAIKI REKONSILIASI SHIF LEGIAN TANGGAL 16/09/2026
  -- ----------------------------------------------------------------------------
  -- AUD: Sisa fisik & sistem = AUD 1.050,00
  UPDATE public.shift_reconciliations
  SET system_balance = 1050.00,
      physical_balance = 1050.00
  WHERE shift_id IN (
    '6eb8f4f5-9984-4236-be9b-2d1f374b7a4e', -- Shif Pagi 16/09
    'f55d20e5-e038-446a-9dfb-b989db62723e'  -- Shif Siang 16/09
  ) AND currency_id = v_aud_id;

  -- IDR: Sisa fisik & sistem = Rp 37.032.500,00
  UPDATE public.shift_reconciliations
  SET system_balance = 37032500.00,
      physical_balance = 37032500.00
  WHERE shift_id IN (
    '6eb8f4f5-9984-4236-be9b-2d1f374b7a4e', -- Shif Pagi 16/09
    'f55d20e5-e038-446a-9dfb-b989db62723e'  -- Shif Siang 16/09
  ) AND currency_id = v_idr_id;

  -- ----------------------------------------------------------------------------
  -- 4. HITUNG ULANG RUNNING BALANCE_AFTER DI LEGIAN
  -- ----------------------------------------------------------------------------
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

  -- ----------------------------------------------------------------------------
  -- 5. SINKRONKAN SALDO KAS AKTIF (CASH_BALANCES) CABANG LEGIAN
  -- ----------------------------------------------------------------------------
  -- Saldo AUD Legian = 1.050,00 (sebelum transfer disetujui)
  UPDATE public.cash_balances
  SET balance = 1050.00,
      updated_at = now()
  WHERE branch_id = v_legian_id AND currency_id = v_aud_id;

  -- Saldo IDR Legian = 37.032.500,00 (sebelum transfer disetujui)
  UPDATE public.cash_balances
  SET balance = 37032500.00,
      updated_at = now()
  WHERE branch_id = v_legian_id AND currency_id = v_idr_id;

  RAISE NOTICE 'Sukses: Transfer 16/09/2026 (AUD 1.050 & IDR 37.032.500) telah disesuaikan dan seluruh saldo kas sinkron.';
END $$;

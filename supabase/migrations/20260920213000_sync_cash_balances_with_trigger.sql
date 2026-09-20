-- =====================================================================
-- PILIHAN A: BERSIHKAN & SINKRONKAN cash_balances
-- Sumber kebenaran tunggal: cash_movements
-- Setiap INSERT ke cash_movements → cash_balances otomatis terupdate
-- =====================================================================

-- -----------------------------------------------------------------------
-- BAGIAN 1: BUAT TRIGGER PERMANEN
-- Trigger ini berjalan setiap kali ada INSERT ke cash_movements
-- (transaksi baru, void/reversal, transfer antar cabang, mutasi manual)
-- Dengan adanya trigger ini, cash_balances SELALU sinkron otomatis.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auto_sync_cash_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Upsert: tambah atau kurangi saldo sesuai jumlah mutasi
  INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
  VALUES (NEW.branch_id, NEW.currency_id, NEW.amount, now())
  ON CONFLICT (branch_id, currency_id)
  DO UPDATE SET
    balance     = public.cash_balances.balance + NEW.amount,
    updated_at  = now();

  RETURN NEW;
END;
$$;

-- Hapus trigger lama jika ada, lalu buat yang baru
DROP TRIGGER IF EXISTS trg_auto_sync_cash_balance ON public.cash_movements;

CREATE TRIGGER trg_auto_sync_cash_balance
  AFTER INSERT ON public.cash_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_sync_cash_balance();

-- -----------------------------------------------------------------------
-- BAGIAN 2: KALIBRASI ULANG cash_balances SEKARANG
-- Rebuild total dari awal menggunakan SUM(cash_movements)
-- Ini menjamin posisi awal yang bersih dan akurat.
-- -----------------------------------------------------------------------
TRUNCATE TABLE public.cash_balances;

INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
SELECT
  branch_id,
  currency_id,
  SUM(amount)   AS balance,
  now()         AS updated_at
FROM public.cash_movements
GROUP BY branch_id, currency_id;

-- -----------------------------------------------------------------------
-- BAGIAN 3: UPDATE get_valas_recap AGAR KONSISTEN
-- Karena cash_balances kini selalu = SUM(cash_movements),
-- dan cash_movements mencatat buy/sell/transfer/void,
-- kita sinkronkan RPC agar juga membaca dari cash_movements
-- per cabang (bukan dari transaction_items yang tidak mencakup transfer).
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_valas_recap(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  currency_id   uuid,
  total_bought  numeric,
  total_sold    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_idr_id uuid;
BEGIN
  SELECT id INTO v_idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  RETURN QUERY
  SELECT
    c.id AS currency_id,
    -- total_bought = semua mutasi MASUK valas (buy + transfer_in + deposit)
    COALESCE(SUM(
      CASE WHEN cm.amount > 0 THEN cm.amount ELSE 0 END
    ), 0) AS total_bought,
    -- total_sold = semua mutasi KELUAR valas (sell + transfer_out + withdrawal)
    COALESCE(SUM(
      CASE WHEN cm.amount < 0 THEN ABS(cm.amount) ELSE 0 END
    ), 0) AS total_sold
  FROM public.currencies c
  LEFT JOIN public.cash_movements cm
    ON  cm.currency_id = c.id
    AND (p_branch_id IS NULL OR cm.branch_id = p_branch_id)
  WHERE c.id != v_idr_id   -- exclude IDR
  GROUP BY c.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_valas_recap(uuid) TO authenticated;

-- Refresh schema PostgREST
NOTIFY pgrst, 'reload schema';

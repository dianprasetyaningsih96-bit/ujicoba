-- Hapus 2 transaksi dobel modal awal dan tambahan modal pada 2 September 2026 pukul 07.47.08
DELETE FROM public.cash_movements WHERE id IN ('a39ac7fc-164c-41b3-875b-b8eeda0f33a2', '0a54435c-2875-4774-9c09-cbc12c1a88ac');

-- Hitung ulang balance_after running mutasi kas Jimbaran
WITH running AS (
  SELECT id, SUM(amount) OVER (PARTITION BY branch_id, currency_id ORDER BY created_at ASC, id ASC) as calc_balance
  FROM public.cash_movements
  WHERE branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde'
)
UPDATE public.cash_movements cm
SET balance_after = running.calc_balance
FROM running
WHERE cm.id = running.id;

-- Sinkronkan saldo kas Jimbaran di tabel cash_balances
UPDATE public.cash_balances cb
SET balance = sub.final_bal, updated_at = now()
FROM (
  SELECT branch_id, currency_id, SUM(amount) as final_bal
  FROM public.cash_movements
  WHERE branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde'
  GROUP BY branch_id, currency_id
) sub
WHERE cb.branch_id = sub.branch_id AND cb.currency_id = sub.currency_id;

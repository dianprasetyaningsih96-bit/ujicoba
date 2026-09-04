-- 1. Hapus branch_transfers terkait Canggu
DELETE FROM public.branch_transfers 
WHERE branch_id = '3b486de1-0302-423b-8835-926ead7ee5f3' 
   OR target_branch_id = '3b486de1-0302-423b-8835-926ead7ee5f3';

-- 2. Hapus cash_movements milik Canggu dan mutasi transfer terkait Canggu di Jimbaran
DELETE FROM public.cash_movements WHERE branch_id = '3b486de1-0302-423b-8835-926ead7ee5f3';
DELETE FROM public.cash_movements WHERE branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde' AND notes ILIKE '%canggu%';

-- 3. Hapus shif dan rekonsiliasi milik Canggu
DELETE FROM public.shift_reconciliations WHERE shift_id IN (SELECT id FROM public.shifts WHERE branch_id = '3b486de1-0302-423b-8835-926ead7ee5f3');
DELETE FROM public.shifts WHERE branch_id = '3b486de1-0302-423b-8835-926ead7ee5f3';

-- 4. Hapus saldo kas Canggu
DELETE FROM public.cash_balances WHERE branch_id = '3b486de1-0302-423b-8835-926ead7ee5f3';

-- 5. Pindahkan nasabah dan profil yang sempat terhubung ke Canggu ke Kantor Pusat (Jimbaran)
UPDATE public.customers SET branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde' WHERE branch_id = '3b486de1-0302-423b-8835-926ead7ee5f3';
UPDATE public.profiles SET branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde' WHERE branch_id = '3b486de1-0302-423b-8835-926ead7ee5f3';

-- 6. Hapus cabang CANGGU dari master cabang
DELETE FROM public.branches WHERE id = '3b486de1-0302-423b-8835-926ead7ee5f3';

-- 7. Hitung ulang running balance_after mutasi kas Jimbaran secara runtut
WITH running AS (
  SELECT id, SUM(amount) OVER (PARTITION BY branch_id, currency_id ORDER BY created_at ASC, id ASC) as calc_balance
  FROM public.cash_movements
  WHERE branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde'
)
UPDATE public.cash_movements cm
SET balance_after = running.calc_balance
FROM running
WHERE cm.id = running.id;

-- 8. Sesuaikan saldo kas fisik Jimbaran agar 100% murni tanpa pengaruh mutasi Canggu
UPDATE public.cash_balances cb
SET balance = COALESCE(sub.final_bal, 0), updated_at = now()
FROM (
  SELECT branch_id, currency_id, SUM(amount) as final_bal
  FROM public.cash_movements
  WHERE branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde'
  GROUP BY branch_id, currency_id
) sub
WHERE cb.branch_id = sub.branch_id AND cb.currency_id = sub.currency_id;

-- 9. Nolkan saldo kas untuk valas yang mutasinya murni hanya berasal dari transfer Canggu (CNY & PHP)
UPDATE public.cash_balances cb
SET balance = 0, updated_at = now()
WHERE branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde'
  AND NOT EXISTS (
    SELECT 1 FROM public.cash_movements cm 
    WHERE cm.branch_id = cb.branch_id AND cm.currency_id = cb.currency_id
  );

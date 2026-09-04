-- 1. Hapus entri duplikat deposit dari buka shif pagi tanggal 3 September 2026
DELETE FROM public.cash_movements WHERE id = 'aceec9de-3885-40b6-b546-cacfb8047a55';

-- 2. Koreksi saldo riil IDR Kantor Pusat (Jimbaran) sebesar Rp 370.151.000,00
UPDATE public.cash_balances 
SET balance = balance - 370151000.00,
    updated_at = now()
WHERE branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde' 
  AND currency_id = 'a09c44fb-31ad-40b4-a4c2-5c506d0fc438';

-- 3. Rapikan balance_after pada seluruh mutasi kas Jimbaran setelah tanggal 3 September
UPDATE public.cash_movements 
SET balance_after = balance_after - 370151000.00 
WHERE branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde' 
  AND currency_id = 'a09c44fb-31ad-40b4-a4c2-5c506d0fc438' 
  AND created_at > '2026-09-03 02:47:16+00';

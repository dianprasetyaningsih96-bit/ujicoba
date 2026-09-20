-- Hapus trigger otomatis yang menyebabkan pencatatan ganda pada cash_movements.
-- create_multi_currency_transaction sudah mencatat mutasi IDR dan Valas secara eksplisit.
DROP TRIGGER IF EXISTS transaction_items_post_cash ON public.transaction_items;
DROP TRIGGER IF EXISTS post_transaction_cash_movements ON public.transactions;

-- Sinkronkan ulang SEMUA cash_balances murni dari cash_movements yang baru saja kita dedup.
-- Tunggu, kita harus menghapus baris duplikat di cash_movements terlebih dahulu untuk transaksi hari ini!
-- Cara termudah mencari duplikat hari ini (dimana trigger dan fungsi sama-sama insert):
-- Kriteria duplikat: transaction_id sama, currency_id sama, amount sama, movement_type sama, waktu berdekatan.
-- Kita cukup menghapus salah satu dari yang ganda (yang diciptakan oleh trigger).

DELETE FROM public.cash_movements cm1
USING public.cash_movements cm2
WHERE cm1.reference_id = cm2.reference_id
  AND cm1.currency_id = cm2.currency_id
  AND cm1.amount = cm2.amount
  AND cm1.movement_type = cm2.movement_type
  AND cm1.id > cm2.id -- Hapus yang ID-nya lebih besar (yang di-insert belakangan oleh trigger)
  AND cm1.reference_id IN (
    SELECT id FROM public.transactions WHERE transaction_date >= '2026-09-20'
  );

-- Setelah duplikat dihapus, kita RECALCULATE cash_balances secara total untuk SEMUA cabang.
TRUNCATE TABLE public.cash_balances;

INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
SELECT 
  branch_id, 
  currency_id, 
  SUM(amount) as balance,
  now()
FROM public.cash_movements
GROUP BY branch_id, currency_id;

-- Notifikasi schema reload
NOTIFY pgrst, 'reload schema';

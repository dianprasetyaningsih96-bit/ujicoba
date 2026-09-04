-- 1. Update apply_shift_opening_capital so it no longer creates a duplicate deposit.
CREATE OR REPLACE FUNCTION public.apply_shift_opening_capital()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
begin
  -- Opening capital pada shif adalah data patokan (benchmark) rekonsiliasi kasir saat tutup shif,
  -- BUKAN merupakan setoran fisik uang tunai baru ke brankas/kasir.
  return new;
end $function$;

-- 2. Hapus entri duplikat deposit dari buka shif pagi hari ini (4 September 2026)
DELETE FROM public.cash_movements WHERE id = '98e00d1b-24db-4f50-a60b-4d79f9d2bfdb';

-- 3. Koreksi saldo riil IDR Kantor Pusat (Jimbaran) agar kembali tepat
UPDATE public.cash_balances 
SET balance = balance - 635426500.00,
    updated_at = now()
WHERE branch_id = 'a33c8202-803b-41a8-a8f9-c46d2f350dde' 
  AND currency_id = 'a09c44fb-31ad-40b4-a4c2-5c506d0fc438';

-- 4. Rapikan balance_after pada mutasi berikutnya yang terjadi setelah baris tersebut
UPDATE public.cash_movements
SET balance_after = balance_after - 635426500.00
WHERE id = '50c865a4-a0ce-47c1-9833-b06fe67a2a85';

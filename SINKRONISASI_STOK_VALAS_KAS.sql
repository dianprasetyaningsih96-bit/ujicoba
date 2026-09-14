-- ==============================================================================
-- SQL: SINKRONISASI STOK VALAS DARI TRANSAKSI RIIL KE KAS & INVENTARIS
-- Jalankan di Supabase SQL Editor (Project: vbmdlqwplfomtzrhafrc)
-- ==============================================================================

DO $$
DECLARE
    v_hq_id UUID;
    v_legian_id UUID;
    v_idr_id UUID;
    t RECORD;
    ti RECORD;
    v_running_bal NUMERIC(20,2);
    b RECORD;
    c RECORD;
BEGIN
    -- 1. Ambil ID Cabang Kantor Pusat dan Legian
    SELECT id INTO v_hq_id 
    FROM public.branches 
    WHERE is_head_office = TRUE OR code = 'HQ-01' OR name ILIKE '%Jimbaran%' OR name ILIKE '%Pusat%'
    LIMIT 1;

    SELECT id INTO v_legian_id 
    FROM public.branches 
    WHERE code = 'HQ-03' OR name ILIKE '%Legian%'
    LIMIT 1;

    SELECT id INTO v_idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

    -- 2. Pastikan transaksi completed yang belum ada di cash_movements dimasukkan
    FOR t IN 
        SELECT tr.* 
        FROM public.transactions tr
        WHERE tr.status = 'completed'
          AND tr.branch_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.cash_movements cm 
              WHERE cm.reference_id = tr.id
          )
    LOOP
        -- A. Masukkan mutasi IDR
        IF v_idr_id IS NOT NULL THEN
            INSERT INTO public.cash_movements (
                branch_id, currency_id, movement_type, amount,
                reference_id, reference_no, notes, created_by, created_at
            ) VALUES (
                t.branch_id, v_idr_id,
                t.transaction_type::text::public.cash_movement_type,
                CASE WHEN t.transaction_type = 'buy' THEN -t.idr_amount ELSE t.idr_amount END,
                t.id, t.transaction_no,
                'Auto dari transaksi (IDR)', t.teller_id, t.transaction_date
            );
        END IF;

        -- B. Masukkan mutasi Valas per item transaksi
        FOR ti IN SELECT * FROM public.transaction_items WHERE transaction_id = t.id LOOP
            INSERT INTO public.cash_movements (
                branch_id, currency_id, movement_type, amount,
                reference_id, reference_no, notes, created_by, created_at
            ) VALUES (
                t.branch_id, ti.currency_id,
                t.transaction_type::text::public.cash_movement_type,
                CASE WHEN t.transaction_type = 'buy' THEN ti.foreign_amount ELSE -ti.foreign_amount END,
                t.id, t.transaction_no,
                'Auto dari transaksi valas', t.teller_id, t.transaction_date
            );
        END LOOP;
    END LOOP;

    -- 3. Hitung ulang running balance dan update cash_balances
    -- untuk semua cabang dan semua mata uang valas (non-IDR)
    FOR b IN SELECT id, code, name FROM public.branches LOOP
        FOR c IN SELECT id, code FROM public.currencies WHERE code <> 'IDR' LOOP
            -- Hitung net posisi valas dari transaksi riil
            SELECT COALESCE(
                SUM(
                    CASE 
                        WHEN tr.transaction_type = 'buy' THEN ti.foreign_amount 
                        WHEN tr.transaction_type = 'sell' THEN -ti.foreign_amount 
                        ELSE 0 
                    END
                ), 0
            ) INTO v_running_bal
            FROM public.transaction_items ti
            JOIN public.transactions tr ON tr.id = ti.transaction_id
            WHERE tr.branch_id = b.id 
              AND ti.currency_id = c.id
              AND tr.status = 'completed';

            -- Jika ada stok valas atau ada transaksi, upsert ke cash_balances
            IF v_running_bal > 0 THEN
                INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at)
                VALUES (b.id, c.id, v_running_bal, now())
                ON CONFLICT (branch_id, currency_id)
                DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();

                RAISE NOTICE 'Sinkronisasi Cabang % (%) - Mata Uang %: Saldo = %', b.name, b.code, c.code, v_running_bal;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Selesai: Seluruh saldo stok valas telah disinkronkan dengan riwayat transaksi fisik.';
END $$;

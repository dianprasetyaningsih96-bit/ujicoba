-- =====================================================================
-- PERBAIKAN BUG DOUBLE-DEDUCTION SALDO CABANG
-- Root cause: frontend shifts.tsx mereset cash_balances ke 0 saat tutup shif,
-- kemudian process_branch_transfer mengurangi lagi saat transfer disetujui.
-- Fix: Frontend tidak lagi mereset ke 0 (sudah diperbaiki di kode).
--      Fungsi database diperbaiki agar akuntansi presisi tanpa GREATEST(0,...).
-- =====================================================================

-- -----------------------------------------------------------------------
-- BAGIAN 1: KOREKSI SALDO LEGIAN YANG SAAT INI NEGATIF
-- Sinkronkan cash_balances agar = SUM(cash_movements) yang sebenarnya
-- -----------------------------------------------------------------------
UPDATE public.cash_balances cb
SET 
  balance = COALESCE(
    (
      SELECT SUM(cm.amount) 
      FROM public.cash_movements cm 
      WHERE cm.branch_id = cb.branch_id 
        AND cm.currency_id = cb.currency_id
    ),
    0
  ),
  updated_at = now()
WHERE cb.branch_id = ''51231cde-4117-4b6d-bcb0-ceb6e047855f''; -- Cabang Legian


-- -----------------------------------------------------------------------
-- BAGIAN 2: PERBARUI process_branch_transfer
-- Hapus GREATEST(0,...) agar saldo selalu mencerminkan angka sebenarnya.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_branch_transfer(
  transfer_id uuid,
  p_status text,
  p_notes text DEFAULT ''''::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_transfer RECORD;
  v_head_office_id uuid;
  v_operator_id uuid;
  v_source_name text;
  v_source_code text;
  v_target_name text;
  v_target_code text;
BEGIN
  v_operator_id := auth.uid();
  SELECT * INTO v_transfer FROM public.branch_transfers WHERE id = transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''Transfer tidak ditemukan (ID: %)'', transfer_id; END IF;
  IF v_transfer.status != ''pending'' THEN RAISE EXCEPTION ''Transfer sudah diproses (Status: %)'', v_transfer.status; END IF;

  SELECT id INTO v_head_office_id FROM public.branches WHERE is_head_office = TRUE LIMIT 1;
  IF v_head_office_id IS NULL THEN SELECT id INTO v_head_office_id FROM public.branches WHERE name ILIKE ''%Pusat%'' OR name ILIKE ''%Jimbaran%'' LIMIT 1; END IF;
  IF v_head_office_id IS NULL THEN SELECT id INTO v_head_office_id FROM public.branches ORDER BY created_at ASC LIMIT 1; END IF;
  IF v_transfer.target_branch_id IS NULL THEN v_transfer.target_branch_id := v_head_office_id; END IF;

  UPDATE public.branch_transfers
  SET status = p_status, processed_at = now(), processed_by = v_operator_id,
      target_branch_id = v_transfer.target_branch_id, notes = COALESCE(NULLIF(p_notes, ''''), notes)
  WHERE id = transfer_id;

  SELECT name, code INTO v_source_name, v_source_code FROM public.branches WHERE id = v_transfer.branch_id;
  SELECT name, code INTO v_target_name, v_target_code FROM public.branches WHERE id = v_transfer.target_branch_id;

  IF p_status = ''accepted'' THEN
    IF v_transfer.target_branch_id = v_head_office_id AND v_transfer.branch_id != v_head_office_id THEN
      INSERT INTO public.cash_movements (branch_id, created_by, currency_id, amount, movement_type, reference_id, notes, reference_no)
      VALUES (v_transfer.branch_id, v_operator_id, v_transfer.currency_id, -v_transfer.amount, ''transfer_out'', transfer_id, ''Setoran sisa kas ke '' || COALESCE(v_target_name, ''Kantor Pusat''), ''TRF-'' || COALESCE(v_target_code, ''HQ''));
      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (v_transfer.branch_id, v_transfer.currency_id, -v_transfer.amount, now())
      ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance - v_transfer.amount, updated_at = now();
      INSERT INTO public.cash_movements (branch_id, created_by, currency_id, amount, movement_type, reference_id, notes, reference_no)
      VALUES (v_head_office_id, v_operator_id, v_transfer.currency_id, v_transfer.amount, ''transfer_in'', transfer_id, ''Terima setoran dari '' || COALESCE(v_source_name, ''Cabang''), ''TRF-'' || COALESCE(v_source_code, ''CAB''));
      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (v_head_office_id, v_transfer.currency_id, v_transfer.amount, now())
      ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance + v_transfer.amount, updated_at = now();
    ELSE
      IF v_transfer.shift_id IS NOT NULL THEN UPDATE public.shifts SET opening_capital = v_transfer.amount WHERE id = v_transfer.shift_id; END IF;
      INSERT INTO public.cash_movements (branch_id, created_by, currency_id, amount, movement_type, reference_id, notes, reference_no)
      VALUES (v_transfer.branch_id, v_operator_id, v_transfer.currency_id, -v_transfer.amount, ''transfer_out'', transfer_id, ''Kirim modal ke '' || COALESCE(v_target_name, ''Cabang''), ''TRF-'' || COALESCE(v_target_code, ''CAB''));
      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (v_transfer.branch_id, v_transfer.currency_id, -v_transfer.amount, now())
      ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance - v_transfer.amount, updated_at = now();
      INSERT INTO public.cash_movements (branch_id, created_by, currency_id, amount, movement_type, reference_id, notes, reference_no)
      VALUES (v_transfer.target_branch_id, v_operator_id, v_transfer.currency_id, v_transfer.amount, ''transfer_in'', transfer_id, ''Terima modal dari '' || COALESCE(v_source_name, ''Kantor Pusat''), ''TRF-'' || COALESCE(v_source_code, ''HQ''));
      INSERT INTO public.cash_balances (branch_id, currency_id, balance, updated_at) VALUES (v_transfer.target_branch_id, v_transfer.currency_id, v_transfer.amount, now())
      ON CONFLICT (branch_id, currency_id) DO UPDATE SET balance = public.cash_balances.balance + v_transfer.amount, updated_at = now();
    END IF;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_branch_transfer(uuid, text, text) TO authenticated;

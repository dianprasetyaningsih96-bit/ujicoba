CREATE OR REPLACE FUNCTION public.admin_edit_transaction(
  p_tx_id uuid,
  p_foreign_amount numeric,
  p_idr_amount numeric,
  p_rate numeric,
  p_customer_id uuid,
  p_notes text,
  p_date timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_tx record;
  idr_id uuid;
  v_foreign_adj numeric;
  v_idr_adj numeric;
BEGIN
  -- Verify role
  IF NOT (has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'Access denied. Only super_admin or owner can edit transactions.';
  END IF;

  -- Get old transaction
  SELECT * INTO v_old_tx FROM public.transactions WHERE id = p_tx_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Get IDR id
  SELECT id INTO idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  IF v_old_tx.status = 'completed' THEN
    -- 1. REVERSE OLD
    IF v_old_tx.transaction_type = 'buy' THEN
      v_foreign_adj := -v_old_tx.foreign_amount;
      v_idr_adj := v_old_tx.idr_amount;
    ELSE
      v_foreign_adj := v_old_tx.foreign_amount;
      v_idr_adj := -v_old_tx.idr_amount;
    END IF;
    INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by)
    VALUES (v_old_tx.branch_id, v_old_tx.currency_id, 'adjustment', v_foreign_adj, p_tx_id, v_old_tx.transaction_no, 'Edit reversal (Foreign)', auth.uid());
    INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by)
    VALUES (v_old_tx.branch_id, idr_id, 'adjustment', v_idr_adj, p_tx_id, v_old_tx.transaction_no, 'Edit reversal (IDR)', auth.uid());
  END IF;

  -- 2. UPDATE TRANSACTION
  UPDATE public.transactions 
  SET 
    foreign_amount = p_foreign_amount,
    idr_amount = p_idr_amount,
    rate = p_rate,
    customer_id = p_customer_id,
    notes = p_notes,
    transaction_date = p_date,
    updated_at = now()
  WHERE id = p_tx_id;

  -- 3. APPLY NEW
  IF v_old_tx.status = 'completed' THEN
    IF v_old_tx.transaction_type = 'buy' THEN
      v_foreign_adj := p_foreign_amount;
      v_idr_adj := -p_idr_amount;
    ELSE
      v_foreign_adj := -p_foreign_amount;
      v_idr_adj := p_idr_amount;
    END IF;
    INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by)
    VALUES (v_old_tx.branch_id, v_old_tx.currency_id, 'adjustment', v_foreign_adj, p_tx_id, v_old_tx.transaction_no, 'Edit apply (Foreign)', auth.uid());
    INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by)
    VALUES (v_old_tx.branch_id, idr_id, 'adjustment', v_idr_adj, p_tx_id, v_old_tx.transaction_no, 'Edit apply (IDR)', auth.uid());
  END IF;

END $$;

GRANT EXECUTE ON FUNCTION public.admin_edit_transaction TO authenticated;

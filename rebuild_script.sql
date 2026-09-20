DO $$
DECLARE
  v_tx RECORD;
  v_item RECORD;
  v_idr_id uuid;
  v_total_idr numeric;
  v_valas_mv numeric;
  v_idr_mv numeric;
  v_existing_id uuid;
BEGIN
  SELECT id INTO v_idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;

  FOR v_tx IN SELECT * FROM public.transactions WHERE status = 'completed' AND branch_id IS NOT NULL LOOP
    
    -- 1. Check IDR movement
    v_total_idr := 0;
    SELECT SUM(idr_amount) INTO v_total_idr FROM public.transaction_items WHERE transaction_id = v_tx.id;
    IF v_total_idr IS NULL THEN v_total_idr := 0; END IF;

    IF v_tx.transaction_type = 'buy' THEN 
      v_idr_mv := -v_total_idr; 
    ELSE 
      v_idr_mv := v_total_idr; 
    END IF;

    SELECT id INTO v_existing_id FROM public.cash_movements WHERE reference_id = v_tx.id AND currency_id = v_idr_id LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      UPDATE public.cash_movements SET amount = v_idr_mv WHERE id = v_existing_id AND amount != v_idr_mv;
    ELSE
      INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by, created_at) 
      VALUES (v_tx.branch_id, v_idr_id, v_tx.transaction_type::text::public.cash_movement_type, v_idr_mv, v_tx.id, v_tx.transaction_no, 'Auto dari transaksi (IDR) (Rebuild)', v_tx.teller_id, v_tx.transaction_date);
    END IF;

    -- 2. Check Valas movements
    FOR v_item IN SELECT * FROM public.transaction_items WHERE transaction_id = v_tx.id LOOP
      IF v_tx.transaction_type = 'buy' THEN 
        v_valas_mv := v_item.foreign_amount; 
      ELSE 
        v_valas_mv := -v_item.foreign_amount; 
      END IF;

      SELECT id INTO v_existing_id FROM public.cash_movements WHERE reference_id = v_tx.id AND currency_id = v_item.currency_id LIMIT 1;
      IF v_existing_id IS NOT NULL THEN
        UPDATE public.cash_movements SET amount = v_valas_mv WHERE id = v_existing_id AND amount != v_valas_mv;
      ELSE
        INSERT INTO public.cash_movements (branch_id, currency_id, movement_type, amount, reference_id, reference_no, notes, created_by, created_at) 
        VALUES (v_tx.branch_id, v_item.currency_id, v_tx.transaction_type::text::public.cash_movement_type, v_valas_mv, v_tx.id, v_tx.transaction_no, 'Auto dari transaksi valas (Rebuild)', v_tx.teller_id, v_tx.transaction_date);
      END IF;
    END LOOP;

  END LOOP;
END $$;

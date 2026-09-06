-- Update reverse_transaction_cash_movements to support reversing all currencies in multi-currency transactions
CREATE OR REPLACE FUNCTION public.reverse_transaction_cash_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  idr_id uuid;
  v_item record;
  v_has_items boolean := false;
  v_foreign numeric(20,2);
  v_idr numeric(20,2);
BEGIN
  IF NEW.branch_id IS NULL THEN RETURN NEW; END IF;
  
  IF OLD.status = 'completed' AND NEW.status = 'voided' THEN
    SELECT id INTO idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;
    IF idr_id IS NULL THEN RETURN NEW; END IF;

    -- 1. Reverse Foreign Currencies from transaction_items
    FOR v_item IN 
      SELECT ti.currency_id, ti.foreign_amount, c.code
      FROM public.transaction_items ti
      JOIN public.currencies c ON c.id = ti.currency_id
      WHERE ti.transaction_id = NEW.id
    LOOP
      v_has_items := true;
      IF NEW.transaction_type = 'buy' THEN
        v_foreign := -v_item.foreign_amount;
      ELSE
        v_foreign := v_item.foreign_amount;
      END IF;

      INSERT INTO public.cash_movements (
        branch_id, currency_id, movement_type, amount, 
        reference_id, reference_no, notes, created_by
      ) VALUES (
        NEW.branch_id, v_item.currency_id, 'adjustment', v_foreign, 
        NEW.id, NEW.transaction_no, 'Void transaksi (' || v_item.code || ')', NEW.voided_by
      );
    END LOOP;

    -- Fallback for legacy single-currency transactions if not found in transaction_items
    IF NOT v_has_items AND NEW.currency_id IS NOT NULL AND NEW.foreign_amount > 0 THEN
      IF NEW.transaction_type = 'buy' THEN
        v_foreign := -NEW.foreign_amount;
      ELSE
        v_foreign := NEW.foreign_amount;
      END IF;

      INSERT INTO public.cash_movements (
        branch_id, currency_id, movement_type, amount, 
        reference_id, reference_no, notes, created_by
      ) VALUES (
        NEW.branch_id, NEW.currency_id, 'adjustment', v_foreign, 
        NEW.id, NEW.transaction_no, 'Void transaksi', NEW.voided_by
      );
    END IF;

    -- 2. Reverse IDR
    IF NEW.transaction_type = 'buy' THEN
      v_idr := NEW.idr_amount;
    ELSE
      v_idr := -NEW.idr_amount;
    END IF;

    INSERT INTO public.cash_movements (
      branch_id, currency_id, movement_type, amount, 
      reference_id, reference_no, notes, created_by
    ) VALUES (
      NEW.branch_id, idr_id, 'adjustment', v_idr, 
      NEW.id, NEW.transaction_no, 'Void transaksi (IDR)', NEW.voided_by
    );
  END IF;

  RETURN NEW;
END;
$function$;

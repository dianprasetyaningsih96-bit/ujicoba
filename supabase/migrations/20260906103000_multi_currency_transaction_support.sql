-- Migration: Support multi-currency transactions per customer and receipt updates

-- 1. Create transaction_items table
CREATE TABLE IF NOT EXISTS public.transaction_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  currency_id uuid NOT NULL REFERENCES public.currencies(id) ON DELETE RESTRICT,
  foreign_amount numeric(18,2) NOT NULL CHECK (foreign_amount > 0),
  rate numeric(18,4) NOT NULL CHECK (rate > 0),
  idr_amount numeric(18,2) NOT NULL CHECK (idr_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_items_tx ON public.transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_curr ON public.transaction_items(currency_id);

-- Enable RLS on transaction_items
ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth read transaction_items" ON public.transaction_items;
CREATE POLICY "Auth read transaction_items" ON public.transaction_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth insert transaction_items" ON public.transaction_items;
CREATE POLICY "Auth insert transaction_items" ON public.transaction_items
  FOR INSERT TO authenticated WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role) OR 
    has_role(auth.uid(), 'branch_manager'::app_role) OR 
    has_role(auth.uid(), 'teller'::app_role) OR 
    has_role(auth.uid(), 'owner'::app_role)
  );

DROP POLICY IF EXISTS "Auth update transaction_items" ON public.transaction_items;
CREATE POLICY "Auth update transaction_items" ON public.transaction_items
  FOR UPDATE TO authenticated USING (
    has_role(auth.uid(), 'super_admin'::app_role) OR 
    has_role(auth.uid(), 'branch_manager'::app_role) OR 
    has_role(auth.uid(), 'owner'::app_role)
  );

DROP POLICY IF EXISTS "Auth delete transaction_items" ON public.transaction_items;
CREATE POLICY "Auth delete transaction_items" ON public.transaction_items
  FOR DELETE TO authenticated USING (
    has_role(auth.uid(), 'super_admin'::app_role) OR 
    has_role(auth.uid(), 'owner'::app_role)
  );

-- 2. Backfill existing transactions into transaction_items (without trigger firing yet)
INSERT INTO public.transaction_items (
  transaction_id, currency_id, foreign_amount, rate, idr_amount, created_at
)
SELECT id, currency_id, foreign_amount, rate, idr_amount, transaction_date
FROM public.transactions
ON CONFLICT DO NOTHING;

-- 3. Trigger to post foreign currency cash movements when transaction_item is inserted
CREATE OR REPLACE FUNCTION public.post_item_cash_movement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tx record;
  v_foreign numeric(20,2);
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = NEW.transaction_id;
  IF NOT FOUND OR v_tx.branch_id IS NULL OR v_tx.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  IF v_tx.transaction_type = 'buy' THEN
    v_foreign := NEW.foreign_amount;
  ELSE
    v_foreign := -NEW.foreign_amount;
  END IF;

  INSERT INTO public.cash_movements (
    branch_id, currency_id, movement_type, amount,
    reference_id, reference_no, notes, created_by, created_at
  ) VALUES (
    v_tx.branch_id, NEW.currency_id,
    v_tx.transaction_type::text::public.cash_movement_type,
    v_foreign, v_tx.id, v_tx.transaction_no,
    'Auto dari transaksi', v_tx.teller_id, v_tx.transaction_date
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transaction_items_post_cash ON public.transaction_items;
CREATE TRIGGER transaction_items_post_cash
  AFTER INSERT ON public.transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION public.post_item_cash_movement();

-- 4. Update post_transaction_cash_movements on transactions to only handle IDR
CREATE OR REPLACE FUNCTION public.post_transaction_cash_movements()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  idr_id uuid;
  v_idr numeric(20,2);
BEGIN
  IF NEW.branch_id IS NULL OR NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO idr_id FROM public.currencies WHERE code = 'IDR' LIMIT 1;
  IF idr_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.transaction_type = 'buy' THEN
    v_idr := -NEW.idr_amount;
  ELSE
    v_idr := NEW.idr_amount;
  END IF;

  INSERT INTO public.cash_movements (
    branch_id, currency_id, movement_type, amount,
    reference_id, reference_no, notes, created_by, created_at
  ) VALUES (
    NEW.branch_id, idr_id,
    NEW.transaction_type::text::public.cash_movement_type,
    v_idr, NEW.id, NEW.transaction_no,
    'Auto dari transaksi (IDR)', NEW.teller_id, NEW.transaction_date
  );

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.create_multi_currency_transaction(uuid, uuid, public.transaction_type, public.payment_method, text, timestamptz, jsonb);

CREATE OR REPLACE FUNCTION public.create_multi_currency_transaction(
  p_branch_id uuid,
  p_customer_id uuid,
  p_transaction_type text,
  p_payment_method text,
  p_notes text,
  p_transaction_date timestamptz,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx record;
  v_item record;
  v_total_idr numeric := 0;
  v_first_curr uuid;
  v_first_foreign numeric;
  v_first_rate numeric;
  v_curr_balance numeric;
  v_res jsonb;
  v_type public.transaction_type;
  v_pay public.payment_method;
BEGIN
  v_type := p_transaction_type::public.transaction_type;
  v_pay := COALESCE(p_payment_method, 'cash')::public.payment_method;

  -- Verify permission
  IF NOT (
    has_role(auth.uid(), 'teller') OR 
    has_role(auth.uid(), 'super_admin') OR 
    has_role(auth.uid(), 'branch_manager') OR 
    has_role(auth.uid(), 'owner')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak. Tidak memiliki izin untuk membuat transaksi.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Minimal harus ada 1 mata uang dalam transaksi.';
  END IF;

  -- Validate stock if selling
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    currency_id uuid, foreign_amount numeric, rate numeric, idr_amount numeric
  )
  LOOP
    v_total_idr := v_total_idr + v_item.idr_amount;

    IF v_type = 'sell' AND p_branch_id IS NOT NULL THEN
      SELECT COALESCE(balance, 0) INTO v_curr_balance
      FROM public.cash_balances
      WHERE branch_id = p_branch_id AND currency_id = v_item.currency_id;

      IF COALESCE(v_curr_balance, 0) < v_item.foreign_amount THEN
        RAISE EXCEPTION 'Stok kas cabang tidak mencukupi untuk mata uang yang dipilih (stok tersedia: %)', COALESCE(v_curr_balance, 0);
      END IF;
    END IF;
  END LOOP;

  -- First item details for header compatibility
  SELECT 
    (p_items->0->>'currency_id')::uuid,
    (p_items->0->>'foreign_amount')::numeric,
    (p_items->0->>'rate')::numeric
  INTO v_first_curr, v_first_foreign, v_first_rate;

  -- 1. Insert transaction header (triggers generate_transaction_no & post_transaction_cash_movements for IDR)
  INSERT INTO public.transactions (
    branch_id, customer_id, transaction_type,
    currency_id, foreign_amount, rate, idr_amount,
    payment_method, status, notes, teller_id, transaction_date
  ) VALUES (
    p_branch_id, p_customer_id, v_type,
    v_first_curr, v_first_foreign, v_first_rate, v_total_idr,
    v_pay, 'completed', p_notes, auth.uid(), COALESCE(p_transaction_date, now())
  ) RETURNING * INTO v_tx;

  -- 2. Insert line items (trigger transaction_items_post_cash handles foreign cash movement for each item)
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    currency_id uuid, foreign_amount numeric, rate numeric, idr_amount numeric
  )
  LOOP
    INSERT INTO public.transaction_items (
      transaction_id, currency_id, foreign_amount, rate, idr_amount, created_at
    ) VALUES (
      v_tx.id, v_item.currency_id, v_item.foreign_amount, v_item.rate, v_item.idr_amount, v_tx.transaction_date
    );
  END LOOP;

  -- Return complete transaction representation with relations
  SELECT to_jsonb(t) INTO v_res FROM (
    SELECT 
      v_tx.id,
      v_tx.transaction_no,
      v_tx.transaction_type,
      v_tx.transaction_date,
      v_tx.customer_id,
      v_tx.currency_id,
      v_tx.branch_id,
      v_tx.rate,
      v_tx.foreign_amount,
      v_tx.idr_amount,
      v_tx.payment_method,
      v_tx.status,
      v_tx.notes,
      v_tx.teller_id,
      (SELECT json_build_object('code', c.code, 'name', c.name) FROM public.currencies c WHERE c.id = v_tx.currency_id) as currencies,
      (SELECT json_build_object('code', b.code, 'name', b.name, 'address', b.address, 'city', b.city, 'phone', b.phone) FROM public.branches b WHERE b.id = v_tx.branch_id) as branches,
      (SELECT json_build_object('customer_code', cust.customer_code, 'full_name', cust.full_name, 'nationality', cust.nationality, 'occupation', cust.occupation, 'date_of_birth', cust.date_of_birth, 'place_of_birth', cust.place_of_birth) FROM public.customers cust WHERE cust.id = v_tx.customer_id) as customers,
      (SELECT json_build_object('full_name', p.full_name) FROM public.profiles p WHERE p.id = v_tx.teller_id) as profiles,
      (
        SELECT json_agg(json_build_object(
          'id', ti.id,
          'currency_id', ti.currency_id,
          'foreign_amount', ti.foreign_amount,
          'rate', ti.rate,
          'idr_amount', ti.idr_amount,
          'currencies', json_build_object('code', cur.code, 'name', cur.name)
        ) ORDER BY ti.created_at ASC)
        FROM public.transaction_items ti
        JOIN public.currencies cur ON cur.id = ti.currency_id
        WHERE ti.transaction_id = v_tx.id
      ) as transaction_items
  ) t;

  RETURN v_res;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_multi_currency_transaction(uuid, uuid, text, text, text, timestamptz, jsonb) TO authenticated;


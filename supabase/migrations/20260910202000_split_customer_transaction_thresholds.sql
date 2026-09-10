-- Add columns for separated monthly transaction threshold settings
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS threshold_individual_buy_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS threshold_individual_buy_usd numeric DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS threshold_individual_sell_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS threshold_individual_sell_usd numeric DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS threshold_corporate_buy_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS threshold_corporate_buy_usd numeric DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS threshold_corporate_sell_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS threshold_corporate_sell_usd numeric DEFAULT 10000;

-- Update existing row if columns are null
UPDATE public.app_settings
SET
  threshold_individual_buy_enabled = COALESCE(threshold_individual_buy_enabled, true),
  threshold_individual_buy_usd = COALESCE(threshold_individual_buy_usd, transaction_threshold_usd, 10000),
  threshold_individual_sell_enabled = COALESCE(threshold_individual_sell_enabled, true),
  threshold_individual_sell_usd = COALESCE(threshold_individual_sell_usd, transaction_threshold_usd, 10000),
  threshold_corporate_buy_enabled = COALESCE(threshold_corporate_buy_enabled, true),
  threshold_corporate_buy_usd = COALESCE(threshold_corporate_buy_usd, transaction_threshold_usd, 10000),
  threshold_corporate_sell_enabled = COALESCE(threshold_corporate_sell_enabled, true),
  threshold_corporate_sell_usd = COALESCE(threshold_corporate_sell_usd, transaction_threshold_usd, 10000)
WHERE id = true;

-- Update check_transaction_threshold RPC function to accept p_transaction_type
CREATE OR REPLACE FUNCTION public.check_transaction_threshold(
  p_customer_id UUID,
  p_new_amount_idr NUMERIC,
  p_threshold_usd NUMERIC,
  p_transaction_type TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_monthly_total_idr NUMERIC;
  v_usd_rate NUMERIC;
  v_total_usd NUMERIC;
BEGIN
  -- 1. Get current month's total IDR for this customer (completed transactions)
  -- Filter by transaction_type if specified (buy or sell)
  SELECT COALESCE(SUM(idr_amount), 0)
  INTO v_monthly_total_idr
  FROM public.transactions
  WHERE customer_id = p_customer_id
    AND status = 'completed'
    AND (p_transaction_type IS NULL OR transaction_type = p_transaction_type)
    AND transaction_date >= date_trunc('month', current_date)
    AND transaction_date < date_trunc('month', current_date) + interval '1 month';

  -- 2. Get current USD Mid Rate for the current month
  SELECT mid_rate INTO v_usd_rate
  FROM public.mid_rates mr
  JOIN public.currencies c ON c.id = mr.currency_id
  WHERE c.code = 'USD'
    AND mr.period_month = date_trunc('month', current_date)::date
  LIMIT 1;

  -- Fallback to latest available rate if not found for current month
  IF v_usd_rate IS NULL THEN
    SELECT mid_rate INTO v_usd_rate
    FROM public.mid_rates mr
    JOIN public.currencies c ON c.id = mr.currency_id
    WHERE c.code = 'USD'
    ORDER BY mr.period_month DESC
    LIMIT 1;
  END IF;

  -- Default to 16000 if no rate found (extreme fallback)
  IF v_usd_rate IS NULL OR v_usd_rate = 0 THEN
    v_usd_rate := 16000;
  END IF;

  -- 3. Calculate total USD including the new transaction
  v_total_usd := (v_monthly_total_idr + p_new_amount_idr) / v_usd_rate;

  -- 4. Return TRUE if within threshold, FALSE if exceeded
  RETURN v_total_usd <= p_threshold_usd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_transaction_threshold(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT ALL ON FUNCTION public.check_transaction_threshold(UUID, NUMERIC, NUMERIC, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_valas_recap(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  currency_id   uuid,
  total_bought  numeric,
  total_sold    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as currency_id,
    COALESCE(SUM(CASE WHEN eff.transaction_type = 'buy' THEN eff.foreign_amount ELSE 0 END), 0) as total_bought,
    COALESCE(SUM(CASE WHEN eff.transaction_type = 'sell' THEN eff.foreign_amount ELSE 0 END), 0) as total_sold
  FROM public.currencies c
  LEFT JOIN (
    SELECT 
      t.branch_id,
      t.transaction_type,
      COALESCE(ti.currency_id, t.currency_id) as currency_id,
      COALESCE(ti.foreign_amount, t.foreign_amount) as foreign_amount
    FROM public.transactions t
    LEFT JOIN public.transaction_items ti ON ti.transaction_id = t.id
    WHERE t.status = 'completed'
  ) eff ON eff.currency_id = c.id AND (p_branch_id IS NULL OR eff.branch_id = p_branch_id)
  WHERE c.code != 'IDR'
  GROUP BY c.id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_valas_recap(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

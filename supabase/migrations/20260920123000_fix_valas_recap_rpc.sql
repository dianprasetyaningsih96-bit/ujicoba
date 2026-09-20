CREATE OR REPLACE FUNCTION public.get_valas_recap(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  currency_id uuid,
  total_bought numeric,
  total_sold numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as currency_id,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'buy' THEN ti.foreign_amount ELSE 0 END), 0) as total_bought,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'sell' THEN ti.foreign_amount ELSE 0 END), 0) as total_sold
  FROM public.currencies c
  LEFT JOIN public.transaction_items ti ON ti.currency_id = c.id
  LEFT JOIN public.transactions t ON t.id = ti.transaction_id 
    AND t.status = 'completed'
    AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
  GROUP BY c.id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_valas_recap(uuid) TO authenticated;

-- Notify schema reload
NOTIFY pgrst, 'reload schema';

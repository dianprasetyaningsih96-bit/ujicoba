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
    cm.currency_id,
    SUM(CASE WHEN cm.movement_type = 'buy' AND cm.amount > 0 THEN cm.amount ELSE 0 END) as total_bought,
    SUM(CASE WHEN cm.movement_type = 'sell' AND cm.amount < 0 THEN ABS(cm.amount) ELSE 0 END) as total_sold
  FROM public.cash_movements cm
  WHERE (p_branch_id IS NULL OR cm.branch_id = p_branch_id)
  GROUP BY cm.currency_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_valas_recap(uuid) TO authenticated;

SELECT 
  movement_type, 
  SUM(amount) as total_amount, 
  COUNT(*) as row_count 
FROM public.cash_movements 
WHERE currency_id = (SELECT id FROM currencies WHERE code = 'AUD' LIMIT 1)
GROUP BY movement_type;

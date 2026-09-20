CREATE OR REPLACE VIEW vw_currency_buy_sell_summary AS
SELECT 
  branch_id,
  currency_id,
  SUM(CASE WHEN movement_type = 'buy' AND amount > 0 THEN amount ELSE 0 END) as total_bought,
  SUM(CASE WHEN movement_type = 'sell' AND amount < 0 THEN ABS(amount) ELSE 0 END) as total_sold
FROM public.cash_movements
GROUP BY branch_id, currency_id;

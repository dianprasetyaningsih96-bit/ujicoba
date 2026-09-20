-- Find transactions that are completed but don't have matching cash_movements for valas
SELECT 
  t.id, t.transaction_no, t.transaction_type, ti.currency_id, ti.foreign_amount, c.code
FROM transactions t
JOIN transaction_items ti ON t.id = ti.transaction_id
JOIN currencies c ON c.id = ti.currency_id
LEFT JOIN cash_movements cm ON cm.reference_id = t.id AND cm.currency_id = ti.currency_id
WHERE t.status = 'completed' AND cm.id IS NULL;

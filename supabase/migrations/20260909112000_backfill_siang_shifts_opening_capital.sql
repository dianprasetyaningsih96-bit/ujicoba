-- Backfill opening_capital for all 'siang' shifts using the remaining IDR balance from the preceding 'pagi' shift reconciliation
UPDATE shifts s_siang
SET opening_capital = sub.pagi_remaining_idr
FROM (
  SELECT 
    s_siang_inner.id AS siang_id,
    COALESCE(sr.physical_balance, sr.system_balance, 0) AS pagi_remaining_idr
  FROM shifts s_siang_inner
  LEFT JOIN LATERAL (
    SELECT s_prev.id, s_prev.closed_at
    FROM shifts s_prev
    WHERE s_prev.branch_id = s_siang_inner.branch_id
      AND s_prev.shift_type = 'pagi'
      AND s_prev.opened_at < s_siang_inner.opened_at
    ORDER BY s_prev.opened_at DESC
    LIMIT 1
  ) s_pagi ON true
  LEFT JOIN currencies c ON c.code = 'IDR'
  LEFT JOIN shift_reconciliations sr ON sr.shift_id = s_pagi.id AND sr.currency_id = c.id
  WHERE s_siang_inner.shift_type = 'siang'
) sub
WHERE s_siang.id = sub.siang_id;

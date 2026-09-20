SELECT tgname, proname 
FROM pg_trigger 
JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid 
JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid 
WHERE relname = 'cash_movements';

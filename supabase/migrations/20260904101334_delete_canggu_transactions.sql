DELETE FROM public.transactions WHERE branch_id IN (SELECT id FROM public.branches WHERE name ILIKE '%canggu%');

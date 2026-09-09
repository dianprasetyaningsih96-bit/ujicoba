-- =====================================================================
-- Migration: Clean up shift opening_capital that was corrupted by closing transfers
-- =====================================================================

UPDATE public.shifts
SET opening_capital = 0.00
WHERE id IN (
  'd55d99fc-8b30-4465-9969-16e7bdee6281', 
  '23ff9d94-c7da-4ff4-9f62-d66ae325985b', 
  'e54eb2d0-6031-48df-874d-85bfdd5d6fb5', 
  '70759618-0008-4a5c-9753-3b2e9f3bca53'
);

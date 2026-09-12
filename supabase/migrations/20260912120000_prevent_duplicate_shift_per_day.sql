-- Migration: Prevent duplicate shifts of same type per branch per day (WITA)

CREATE OR REPLACE FUNCTION check_duplicate_shift_per_day()
RETURNS TRIGGER AS $$
DECLARE
  v_shift_date date;
  v_exists boolean;
BEGIN
  -- Tentukan tanggal kalender shif dalam zona waktu WITA (Asia/Makassar, UTC+8)
  v_shift_date := (COALESCE(NEW.opened_at, now()) AT TIME ZONE 'Asia/Makassar')::date;

  SELECT EXISTS (
    SELECT 1 FROM public.shifts
    WHERE branch_id = NEW.branch_id
      AND shift_type = NEW.shift_type
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (opened_at AT TIME ZONE 'Asia/Makassar')::date = v_shift_date
  ) INTO v_exists;

  IF v_exists THEN
    RAISE EXCEPTION 'Shif % untuk cabang ini sudah pernah dibuka pada tanggal % (WITA). Tidak diperbolehkan membuka shif yang sama 2x dalam satu hari.',
      CASE WHEN NEW.shift_type = 'pagi' THEN 'Pagi' ELSE 'Siang/Sore' END,
      to_char(v_shift_date, 'DD/MM/YYYY');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_duplicate_shift_per_day ON public.shifts;
CREATE TRIGGER trg_check_duplicate_shift_per_day
  BEFORE INSERT OR UPDATE OF branch_id, shift_type, opened_at
  ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION check_duplicate_shift_per_day();

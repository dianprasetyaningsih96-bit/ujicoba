-- 1. Hapus semua riwayat aksi 'update' (Ubah) dan 'delete' (Hapus) dari audit_logs
DELETE FROM public.audit_logs WHERE action IN ('update', 'delete');

-- 2. Perbarui fungsi log_audit_event agar hanya mencatat 'INSERT' (Tambah)
CREATE OR REPLACE FUNCTION public.log_audit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_new jsonb;
  v_id uuid;
begin
  -- Jangan catat aksi UPDATE atau DELETE ke audit trail
  if tg_op in ('UPDATE', 'DELETE') then
    return coalesce(new, old);
  end if;

  begin
    select email into v_email from auth.users where id = v_actor;
  exception when others then v_email := null; end;

  v_new := to_jsonb(new);
  v_id := (v_new->>'id')::uuid;

  insert into public.audit_logs(
    table_name, record_id, action, actor_id, actor_email,
    old_data, new_data, changed_fields
  ) values (
    tg_table_name, v_id, 'insert'::public.audit_action,
    v_actor, v_email, null, v_new, null
  );

  return new;
end $function$;

-- 3. Ubah seluruh trigger audit pada semua tabel agar hanya aktif pada AFTER INSERT
DROP TRIGGER IF EXISTS customers_audit ON public.customers;
CREATE TRIGGER customers_audit AFTER INSERT ON public.customers FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS transactions_audit ON public.transactions;
CREATE TRIGGER transactions_audit AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS exchange_rates_audit ON public.exchange_rates;
CREATE TRIGGER exchange_rates_audit AFTER INSERT ON public.exchange_rates FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS currencies_audit ON public.currencies;
CREATE TRIGGER currencies_audit AFTER INSERT ON public.currencies FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS branches_audit ON public.branches;
CREATE TRIGGER branches_audit AFTER INSERT ON public.branches FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS user_roles_audit ON public.user_roles;
CREATE TRIGGER user_roles_audit AFTER INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS cash_movements_audit ON public.cash_movements;
CREATE TRIGGER cash_movements_audit AFTER INSERT ON public.cash_movements FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS approval_requests_audit ON public.approval_requests;
CREATE TRIGGER approval_requests_audit AFTER INSERT ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

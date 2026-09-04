CREATE OR REPLACE FUNCTION public.log_audit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
  v_changed text[];
  v_key text;
begin
  -- Don't log transactions update or delete
  if tg_table_name = 'transactions' and tg_op in ('UPDATE', 'DELETE') then
    return coalesce(new, old);
  end if;

  -- Don't log cash_movements resulting from transaction edits (using to_jsonb to safely check notes across different tables)
  if tg_table_name = 'cash_movements' then
    if (coalesce(to_jsonb(new)->>'notes', '') like 'Edit %' or coalesce(to_jsonb(old)->>'notes', '') like 'Edit %') then
      return coalesce(new, old);
    end if;
  end if;

  begin
    select email into v_email from auth.users where id = v_actor;
  exception when others then v_email := null; end;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_new := null;
    v_id := (v_old->>'id')::uuid;
  elsif tg_op = 'INSERT' then
    v_old := null;
    v_new := to_jsonb(new);
    v_id := (v_new->>'id')::uuid;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_id := (v_new->>'id')::uuid;
    v_changed := array(
      select key from jsonb_each(v_new)
      where v_new->key is distinct from v_old->key
        and key not in ('updated_at')
    );
    -- Skip update jika tidak ada perubahan berarti
    if v_changed is null or array_length(v_changed,1) is null then
      return coalesce(new, old);
    end if;
  end if;

  insert into public.audit_logs(
    table_name, record_id, action, actor_id, actor_email,
    old_data, new_data, changed_fields
  ) values (
    tg_table_name, v_id, lower(tg_op)::public.audit_action,
    v_actor, v_email, v_old, v_new, v_changed
  );

  return coalesce(new, old);
end $function$;

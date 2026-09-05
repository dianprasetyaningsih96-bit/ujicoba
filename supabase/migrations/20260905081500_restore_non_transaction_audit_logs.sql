-- Migration: Restore non-transaction audit logs (customers, branches, exchange_rates, currencies, user_roles)
-- and restrict audit exclusion exclusively to transactions and cash_movements.

-- 1. Update log_audit_event to only exclude UPDATE and DELETE on transactions and cash_movements
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
begin
  -- Jangan catat aksi UPDATE atau DELETE untuk transaksi dan mutasi kas transaksi
  if tg_table_name in ('transactions', 'cash_movements') and tg_op in ('UPDATE', 'DELETE') then
    return coalesce(new, old);
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
    if v_changed is null or array_length(v_changed, 1) is null then
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

-- 2. Recreate triggers on non-transaction tables to record INSERT, UPDATE, and DELETE
DROP TRIGGER IF EXISTS customers_audit ON public.customers;
CREATE TRIGGER customers_audit AFTER INSERT OR UPDATE OR DELETE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS branches_audit ON public.branches;
CREATE TRIGGER branches_audit AFTER INSERT OR UPDATE OR DELETE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS exchange_rates_audit ON public.exchange_rates;
CREATE TRIGGER exchange_rates_audit AFTER INSERT OR UPDATE OR DELETE ON public.exchange_rates FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS currencies_audit ON public.currencies;
CREATE TRIGGER currencies_audit AFTER INSERT OR UPDATE OR DELETE ON public.currencies FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS user_roles_audit ON public.user_roles;
CREATE TRIGGER user_roles_audit AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS approval_requests_audit ON public.approval_requests;
CREATE TRIGGER approval_requests_audit AFTER INSERT OR UPDATE OR DELETE ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

-- 3. Transactions and cash_movements triggers remain active for INSERT only
DROP TRIGGER IF EXISTS transactions_audit ON public.transactions;
CREATE TRIGGER transactions_audit AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS cash_movements_audit ON public.cash_movements;
CREATE TRIGGER cash_movements_audit AFTER INSERT ON public.cash_movements FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

-- 4. Restore the historical non-transaction audit records
INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  '3871eece-6d3c-4385-b2d5-7286184c5166', 'exchange_rates', '7013377e-2235-40b9-b4ef-09e56e283423', 'update'::public.audit_action, '238c3c45-a541-4661-8f4d-a2844fc5ace4', 'superadmin@amv.com',
  '{"id": "7013377e-2235-40b9-b4ef-09e56e283423", "note": null, "buy_rate": 17800.0, "branch_id": null, "is_active": true, "sell_rate": 18000.0, "created_at": "2026-07-20T12:41:27.46899+00:00", "created_by": null, "updated_at": "2026-08-16T13:00:02.439762+00:00", "currency_id": "43da64e1-ece2-4536-97ad-98a56e6c59c2", "effective_date": "2026-08-16"}'::jsonb, '{"id": "7013377e-2235-40b9-b4ef-09e56e283423", "note": null, "buy_rate": 17450.0, "branch_id": null, "is_active": true, "sell_rate": 18000.0, "created_at": "2026-07-20T12:41:27.46899+00:00", "created_by": null, "updated_at": "2026-09-01T06:02:12.634645+00:00", "currency_id": "43da64e1-ece2-4536-97ad-98a56e6c59c2", "effective_date": "2026-08-16"}'::jsonb, ARRAY['buy_rate']::text[], NULL, NULL, '2026-09-01T06:02:12.634645+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  '424219d1-b872-49aa-9365-4ea08009dc8c', 'currencies', 'ae60b292-7eb8-4364-8adc-cc261dffb743', 'update'::public.audit_action, '238c3c45-a541-4661-8f4d-a2844fc5ace4', 'superadmin@amv.com',
  '{"id": "ae60b292-7eb8-4364-8adc-cc261dffb743", "code": "PHP", "name": "PHP Peso", "symbol": "\u00e2\u201a\u00b1", "country": "Philippines", "decimals": 2, "is_active": true, "created_at": "2026-09-01T07:34:22.013722+00:00", "updated_at": "2026-09-01T07:34:22.013722+00:00"}'::jsonb, '{"id": "ae60b292-7eb8-4364-8adc-cc261dffb743", "code": "PHP", "name": "Philippines Peso", "symbol": "\u00e2\u201a\u00b1", "country": "Philippines", "decimals": 2, "is_active": true, "created_at": "2026-09-01T07:34:22.013722+00:00", "updated_at": "2026-09-01T07:34:44.608575+00:00"}'::jsonb, ARRAY['name']::text[], NULL, NULL, '2026-09-01T07:34:44.608575+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  '1bdf41dc-f2a4-4dfe-b453-c3f6d1fc6eba', 'exchange_rates', 'af129952-5f48-4874-a9ae-9d1410c1b430', 'delete'::public.audit_action, 'cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf', 'tellerlegian@gmail.com',
  '{"id": "af129952-5f48-4874-a9ae-9d1410c1b430", "note": null, "buy_rate": 18000.0, "branch_id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "is_active": true, "sell_rate": 18000.0, "created_at": "2026-09-02T00:13:44.281341+00:00", "created_by": null, "updated_at": "2026-09-02T00:13:44.281341+00:00", "currency_id": "43da64e1-ece2-4536-97ad-98a56e6c59c2", "effective_date": "2026-09-02"}'::jsonb, NULL, NULL, NULL, NULL, '2026-09-02T00:14:32.996151+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  'f034cc50-28f0-49dc-bd26-a99243a051ed', 'exchange_rates', '7a402683-95dd-4c84-9362-343c5f3b3d5a', 'delete'::public.audit_action, 'cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf', 'tellerlegian@gmail.com',
  '{"id": "7a402683-95dd-4c84-9362-343c5f3b3d5a", "note": null, "buy_rate": 4338.0, "branch_id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "is_active": true, "sell_rate": 4338.0, "created_at": "2026-09-02T00:16:07.410851+00:00", "created_by": null, "updated_at": "2026-09-02T00:16:07.410851+00:00", "currency_id": "bf8331dd-f521-48fe-bd1a-fa704916c886", "effective_date": "2026-09-02"}'::jsonb, NULL, NULL, NULL, NULL, '2026-09-02T00:16:25.988406+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  '7d225ec0-936d-403b-8990-2c912a8f795d', 'branches', 'a33c8202-803b-41a8-a8f9-c46d2f350dde', 'update'::public.audit_action, '238c3c45-a541-4661-8f4d-a2844fc5ace4', 'superadmin@amv.com',
  '{"id": "a33c8202-803b-41a8-a8f9-c46d2f350dde", "city": "BADUNG", "code": "HQ-01", "name": "Kantor Pusat", "is_hq": true, "phone": "+62 812-4668-468", "address": "Jl. Raya Uluwatu I No 66 Jimbaran, Badung, Bali", "is_active": true, "created_at": "2026-07-21T18:20:25.362588+00:00", "license_no": "11111111111", "updated_at": "2026-08-30T05:29:52.193234+00:00", "is_head_office": true}'::jsonb, '{"id": "a33c8202-803b-41a8-a8f9-c46d2f350dde", "city": "BADUNG", "code": "HQ-01", "name": "Kantor Pusat (Jimbaran)", "is_hq": true, "phone": "+62 812-4668-468", "address": "Jl. Raya Uluwatu I No 66 Jimbaran, Badung, Bali", "is_active": true, "created_at": "2026-07-21T18:20:25.362588+00:00", "license_no": "11111111111", "updated_at": "2026-09-02T00:41:28.191043+00:00", "is_head_office": true}'::jsonb, ARRAY['name']::text[], NULL, NULL, '2026-09-02T00:41:28.191043+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  'b7461691-8f93-4c3c-aa67-dacfd46c43d0', 'customers', 'af5b7c4a-535b-42ed-b7c6-137eb588b53b', 'delete'::public.audit_action, NULL, NULL,
  '{"id": "af5b7c4a-535b-42ed-b7c6-137eb588b53b", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": null, "id_type": "ktp", "employer": null, "province": null, "branch_id": "a33c8202-803b-41a8-a8f9-c46d2f350dde", "full_name": "COBA", "id_number": "070275Q007873", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-03T00:01:40.293971+00:00", "created_by": "238c3c45-a541-4661-8f4d-a2844fc5ace4", "kyc_status": "pending", "occupation": null, "updated_at": "2026-09-03T00:01:40.293971+00:00", "nationality": "ID", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0019", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, NULL, NULL, NULL, NULL, '2026-09-03T00:29:20.889506+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  '9dd86340-f1f5-4815-bece-5d869752176a', 'user_roles', '328d900e-269c-494f-98b4-f576317c4fe3', 'delete'::public.audit_action, '238c3c45-a541-4661-8f4d-a2844fc5ace4', 'superadmin@amv.com',
  '{"id": "328d900e-269c-494f-98b4-f576317c4fe3", "role": "teller", "user_id": "2f9a1386-eee5-4cb8-8699-5f7be4b777a5", "assigned_at": "2026-09-03T06:23:25.585802+00:00", "assigned_by": null}'::jsonb, NULL, NULL, NULL, NULL, '2026-09-03T06:23:26.407754+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  '3dd55069-d46a-485d-9395-5becdc57cec1', 'user_roles', '9b9733b5-1b42-4e1a-87e7-9b86f394f006', 'delete'::public.audit_action, NULL, NULL,
  '{"id": "9b9733b5-1b42-4e1a-87e7-9b86f394f006", "role": "super_admin", "user_id": "2f9a1386-eee5-4cb8-8699-5f7be4b777a5", "assigned_at": "2026-09-03T06:23:26.558674+00:00", "assigned_by": "238c3c45-a541-4661-8f4d-a2844fc5ace4"}'::jsonb, NULL, NULL, NULL, NULL, '2026-09-03T06:31:15.384899+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  '454f97a0-3dda-47df-9b03-d57c4bf7f872', 'branches', '51231cde-4117-4b6d-bcb0-ceb6e047855f', 'delete'::public.audit_action, NULL, NULL,
  '{"id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "city": "Badung", "code": "HQ-03", "name": "Legian", "is_hq": false, "phone": "08080808", "address": "Legian", "is_active": false, "created_at": "2026-08-07T09:32:53.261234+00:00", "license_no": null, "updated_at": "2026-09-04T11:52:01.212092+00:00", "is_head_office": false}'::jsonb, NULL, NULL, NULL, NULL, '2026-09-04T11:52:01.212092+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  'a35ff552-8dad-47c4-a330-eb1e5db7ba9b', 'exchange_rates', '1687959a-16fa-46ec-b3ca-12e267b3a461', 'delete'::public.audit_action, NULL, NULL,
  '{"id": "1687959a-16fa-46ec-b3ca-12e267b3a461", "note": null, "buy_rate": 4388.0, "branch_id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "is_active": true, "sell_rate": 4388.0, "created_at": "2026-09-02T00:16:55.188741+00:00", "created_by": null, "updated_at": "2026-09-02T00:16:55.188741+00:00", "currency_id": "bf8331dd-f521-48fe-bd1a-fa704916c886", "effective_date": "2026-09-02"}'::jsonb, NULL, NULL, NULL, NULL, '2026-09-04T11:52:01.212092+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  'f0361b74-a25f-480d-8ead-229a0f31681e', 'branches', '51231cde-4117-4b6d-bcb0-ceb6e047855f', 'update'::public.audit_action, NULL, NULL,
  '{"id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "city": "Badung", "code": "HQ-03", "name": "Legian", "is_hq": false, "phone": "08080808", "address": "Legian", "is_active": true, "created_at": "2026-08-07T09:32:53.261234+00:00", "license_no": null, "updated_at": "2026-08-30T05:29:52.403309+00:00", "is_head_office": false}'::jsonb, '{"id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "city": "Badung", "code": "HQ-03", "name": "Legian", "is_hq": false, "phone": "08080808", "address": "Legian", "is_active": false, "created_at": "2026-08-07T09:32:53.261234+00:00", "license_no": null, "updated_at": "2026-09-04T11:52:01.212092+00:00", "is_head_office": false}'::jsonb, ARRAY['is_active']::text[], NULL, NULL, '2026-09-04T11:52:01.212092+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  'ed3bf6b3-b902-4475-9a96-c9a641793e79', 'customers', 'af246a91-d513-4187-8f89-94ef4ff0bb4c', 'update'::public.audit_action, NULL, NULL,
  '{"id": "af246a91-d513-4187-8f89-94ef4ff0bb4c", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "KUMALA PANTAI", "id_type": "passport", "employer": null, "province": null, "branch_id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "full_name": "AMBER MCDONALD", "id_number": "PA2364578", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-01T04:42:48.817484+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "RETAIL", "updated_at": "2026-09-01T04:42:48.817484+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0001", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, '{"id": "af246a91-d513-4187-8f89-94ef4ff0bb4c", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "KUMALA PANTAI", "id_type": "passport", "employer": null, "province": null, "branch_id": null, "full_name": "AMBER MCDONALD", "id_number": "PA2364578", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-01T04:42:48.817484+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "RETAIL", "updated_at": "2026-09-04T11:52:01.212092+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0001", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, ARRAY['branch_id']::text[], NULL, NULL, '2026-09-04T11:52:01.212092+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  'dedfbc57-f497-4a86-b008-10bf917b805c', 'customers', 'c15bd38c-95da-4b63-abb7-5897614f9575', 'update'::public.audit_action, NULL, NULL,
  '{"id": "c15bd38c-95da-4b63-abb7-5897614f9575", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "KUMALA PANTAI", "id_type": "passport", "employer": null, "province": null, "branch_id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "full_name": "MELISA MCDONALD", "id_number": "PA1248953", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-01T06:35:35.932025+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "TEACHER", "updated_at": "2026-09-01T06:35:35.932025+00:00", "nationality": "ID", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0004", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, '{"id": "c15bd38c-95da-4b63-abb7-5897614f9575", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "KUMALA PANTAI", "id_type": "passport", "employer": null, "province": null, "branch_id": null, "full_name": "MELISA MCDONALD", "id_number": "PA1248953", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-01T06:35:35.932025+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "TEACHER", "updated_at": "2026-09-04T11:52:01.212092+00:00", "nationality": "ID", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0004", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, ARRAY['branch_id']::text[], NULL, NULL, '2026-09-04T11:52:01.212092+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  '82db92c6-41f3-4a7c-bdcf-166dce410202', 'customers', 'd2ee35ba-d4ff-4e33-a784-2bbb4b742f97', 'update'::public.audit_action, NULL, NULL,
  '{"id": "d2ee35ba-d4ff-4e33-a784-2bbb4b742f97", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "KUMALA PANTAI", "id_type": "passport", "employer": null, "province": null, "branch_id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "full_name": "EBONY MCDONALD", "id_number": "PA1209834", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-02T04:28:40.300964+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "STUDENT", "updated_at": "2026-09-02T04:28:40.300964+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0006", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, '{"id": "d2ee35ba-d4ff-4e33-a784-2bbb4b742f97", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "KUMALA PANTAI", "id_type": "passport", "employer": null, "province": null, "branch_id": null, "full_name": "EBONY MCDONALD", "id_number": "PA1209834", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-02T04:28:40.300964+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "STUDENT", "updated_at": "2026-09-04T11:52:01.212092+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0006", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, ARRAY['branch_id']::text[], NULL, NULL, '2026-09-04T11:52:01.212092+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  'd5812e8d-1b5a-433b-9f7f-48116ba4f2e7', 'customers', 'd688de2e-4c44-40db-9960-04474ccceb9b', 'update'::public.audit_action, NULL, NULL,
  '{"id": "d688de2e-4c44-40db-9960-04474ccceb9b", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "KUMALA PANTAI", "id_type": "passport", "employer": null, "province": null, "branch_id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "full_name": "KYLIE HIGGINS", "id_number": "PA1695483", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-02T04:34:25.14827+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "NURSE", "updated_at": "2026-09-02T04:34:25.14827+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0007", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, '{"id": "d688de2e-4c44-40db-9960-04474ccceb9b", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "KUMALA PANTAI", "id_type": "passport", "employer": null, "province": null, "branch_id": null, "full_name": "KYLIE HIGGINS", "id_number": "PA1695483", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-02T04:34:25.14827+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "NURSE", "updated_at": "2026-09-04T11:52:01.212092+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0007", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, ARRAY['branch_id']::text[], NULL, NULL, '2026-09-04T11:52:01.212092+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  '4c8d17fb-df3a-4f8f-8563-5c7b7a2dea3c', 'customers', '3a559ebf-f31e-4489-b4ee-31ae51676d96', 'update'::public.audit_action, NULL, NULL,
  '{"id": "3a559ebf-f31e-4489-b4ee-31ae51676d96", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "JAYAKARTA", "id_type": "passport", "employer": null, "province": null, "branch_id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "full_name": "TEALA HAND", "id_number": "PA1286349", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-03T05:41:35.002351+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "REAL ESTATE", "updated_at": "2026-09-03T05:41:35.002351+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0020", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, '{"id": "3a559ebf-f31e-4489-b4ee-31ae51676d96", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "JAYAKARTA", "id_type": "passport", "employer": null, "province": null, "branch_id": null, "full_name": "TEALA HAND", "id_number": "PA1286349", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-03T05:41:35.002351+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": "REAL ESTATE", "updated_at": "2026-09-04T11:52:01.212092+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0020", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, ARRAY['branch_id']::text[], NULL, NULL, '2026-09-04T11:52:01.212092+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

INSERT INTO public.audit_logs (
  id, table_name, record_id, action, actor_id, actor_email,
  old_data, new_data, changed_fields, ip_address, user_agent, created_at
) VALUES (
  'f9bf9ccf-a5c9-4f33-8c4f-d102b76a4491', 'customers', '0447507d-5367-4b66-acb2-0c4ee7c50499', 'update'::public.audit_action, NULL, NULL,
  '{"id": "0447507d-5367-4b66-acb2-0c4ee7c50499", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "VILLA NABI", "id_type": "passport", "employer": null, "province": null, "branch_id": "51231cde-4117-4b6d-bcb0-ceb6e047855f", "full_name": "CAROLINE ZANSSI", "id_number": "PA1149538", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-03T05:43:32.833748+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": null, "updated_at": "2026-09-03T05:43:32.833748+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0021", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, '{"id": "0447507d-5367-4b66-acb2-0c4ee7c50499", "city": null, "email": null, "phone": null, "gender": null, "is_pep": false, "address": "VILLA NABI", "id_type": "passport", "employer": null, "province": null, "branch_id": null, "full_name": "CAROLINE ZANSSI", "id_number": "PA1149538", "kyc_notes": null, "pep_notes": null, "created_at": "2026-09-03T05:43:32.833748+00:00", "created_by": "cbe3e20d-6a25-44cb-bafa-b6bf3b738cdf", "kyc_status": "pending", "occupation": null, "updated_at": "2026-09-04T11:52:01.212092+00:00", "nationality": "AU", "npwp_number": null, "postal_code": null, "risk_rating": "low", "company_name": null, "business_type": null, "customer_code": "CUS-202609-0021", "customer_type": "individual", "date_of_birth": null, "id_expiry_date": null, "is_blacklisted": false, "place_of_birth": null, "kyc_verified_at": null, "kyc_verified_by": null, "source_of_funds": null, "blacklist_reason": null, "monthly_income_range": null, "purpose_of_transaction": null}'::jsonb, ARRAY['branch_id']::text[], NULL, NULL, '2026-09-04T11:52:01.212092+00:00'::timestamptz
) ON CONFLICT (id) DO UPDATE SET
  old_data = EXCLUDED.old_data,
  new_data = EXCLUDED.new_data,
  changed_fields = EXCLUDED.changed_fields;

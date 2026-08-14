create or replace function public.treasury_sales_source_status(
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_role text;
  v_connected boolean := false;
  v_source text := null;
  v_candidates text[] := array[]::text[];
begin
  select a.role
    into v_role
  from public.staff_sessions s
  join public.staff_accounts a on a.id=s.account_id
  where s.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null
    and s.expires_at>now()
    and a.status='active'
  order by s.created_at desc
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  if v_role not in ('general_manager','branch_manager','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  select coalesce(array_agg(t.table_name order by t.table_name), array[]::text[])
    into v_candidates
  from information_schema.tables t
  where t.table_schema='public'
    and t.table_name in ('sales_invoices','sales_bills','customer_sales_invoices','pos_sales','sales_transactions');

  if cardinality(v_candidates) > 0 then
    v_connected := true;
    v_source := v_candidates[1];
  end if;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'connected',v_connected,
      'source_table',v_source,
      'candidate_tables',to_jsonb(v_candidates),
      'mode',case when v_connected then 'available' else 'not_connected' end,
      'message',case when v_connected
        then 'مصدر مبيعات مستقل متاح للمطابقة.'
        else 'لا يوجد جدول مبيعات/فواتير مستقل داخل قاعدة DawaaBills حاليًا؛ لا يتم اختراع مطابقة غير موجودة.'
      end
    )
  );
end;
$function$;

grant execute on function public.treasury_sales_source_status(text) to anon, authenticated;

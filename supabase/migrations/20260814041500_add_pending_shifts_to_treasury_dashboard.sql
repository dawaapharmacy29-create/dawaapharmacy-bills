do $$
declare
  v_oid oid;
  v_def text;
  v_old text := '''transfers'',coalesce((select jsonb_agg(to_jsonb(f) order by f.transaction_date desc,f.created_at desc) from public.financial_transfers f),''[]''::jsonb)';
  v_new text := '''pending_shifts'',coalesce((select jsonb_agg(to_jsonb(s) order by s.shift_date desc,s.created_at desc) from public.shift_deliveries s where coalesce(s.treasury_status,''pending'') in (''pending'',''pending_review'') and (v_role=''general_manager'' or coalesce(jsonb_array_length(case when jsonb_typeof(coalesce(acc.branch_ids,''[]''::jsonb))=''array'' then coalesce(acc.branch_ids,''[]''::jsonb) else ''[]''::jsonb end),0)=0 or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(coalesce(acc.branch_ids,''[]''::jsonb))=''array'' then coalesce(acc.branch_ids,''[]''::jsonb) else ''[]''::jsonb end) b(branch_name) where b.branch_name=s.branch))),''[]''::jsonb),
   ''transfers'',coalesce((select jsonb_agg(to_jsonb(f) order by f.transaction_date desc,f.created_at desc) from public.financial_transfers f),''[]''::jsonb)';
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='treasury_center'
    and pg_get_function_identity_arguments(p.oid)='p_session_token text, p_action text, p_payload jsonb'
  limit 1;

  if v_oid is null then
    raise exception 'treasury_center not found';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position('''pending_shifts''' in v_def) > 0 then
    return;
  end if;

  if position(v_old in v_def)=0 then
    raise exception 'expected dashboard transfers expression not found';
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end $$;

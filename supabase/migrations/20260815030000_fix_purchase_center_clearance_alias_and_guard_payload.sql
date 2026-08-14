do $fix$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='smart_purchase_clearance_engine_v1'
  limit 1;
  if v_def is null then raise exception 'smart_purchase_clearance_engine_v1 not found'; end if;
  v_def := replace(v_def,
    'select a.*,greatest(0,units_to_act-suggested_transfer_units)::numeric local_push_units,',
    'select action_row.*,greatest(0,units_to_act-suggested_transfer_units)::numeric local_push_units,');
  v_def := replace(v_def, 'from actions a\n  )', 'from actions action_row\n  )');
  execute v_def;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='smart_purchase_decision_daily_change_v1'
  limit 1;
  if v_def is null then raise exception 'smart_purchase_decision_daily_change_v1 not found'; end if;
  v_def := replace(v_def,
    'jsonb_array_elements(coalesce(v_guard->''branches'',''[]''::jsonb))',
    'jsonb_array_elements(coalesce(v_guard->''data''->''branches'',v_guard->''branches'',''[]''::jsonb))');
  execute v_def;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='smart_purchase_safe_draft_preview_v1'
  limit 1;
  if v_def is null then raise exception 'smart_purchase_safe_draft_preview_v1 not found'; end if;
  v_def := replace(v_def,
    'jsonb_array_elements(coalesce(v_guard->''branches'',''[]''::jsonb))',
    'jsonb_array_elements(coalesce(v_guard->''data''->''branches'',v_guard->''branches'',''[]''::jsonb))');
  execute v_def;
end
$fix$;

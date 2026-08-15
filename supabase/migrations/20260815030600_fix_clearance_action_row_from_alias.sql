do $fix$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='smart_purchase_clearance_engine_v1'
  limit 1;

  if v_def is null then
    raise exception 'smart_purchase_clearance_engine_v1 not found';
  end if;

  -- Keep the selected row alias and the FROM alias in sync. The previous
  -- hotfix could replace SELECT action_row.* without matching whitespace in
  -- the FROM clause, which produced: missing FROM-clause entry for table action_row.
  v_def := regexp_replace(v_def, 'select\s+a\.\*,', 'select action_row.*,', 'i');
  v_def := regexp_replace(v_def, 'from\s+actions\s+a([\s\r\n]+\))', 'from actions action_row\1', 'i');

  execute v_def;
end
$fix$;

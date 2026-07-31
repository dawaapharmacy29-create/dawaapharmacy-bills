create or replace function public.smart_purchase_apply_budget_plan(
  p_session_token text,
  p_order_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_ok boolean := false;
  v_rec record;
  v_sql text;
  v_item_table text;
  v_updated integer := 0;
  v_expected integer := 0;
begin
  if coalesce(trim(p_session_token), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  for v_rec in
    select c.table_schema, c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name in ('session_token', 'token')
      and (c.table_name ilike '%session%' or c.table_name ilike '%staff%' or c.table_name ilike '%auth%')
  loop
    begin
      v_sql := format('select exists(select 1 from %I.%I where %I = $1)', v_rec.table_schema, v_rec.table_name, v_rec.column_name);
      execute v_sql into v_session_ok using p_session_token;
      exit when v_session_ok;
    exception when others then
      v_session_ok := false;
    end;
  end loop;

  if not v_session_ok then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  select format('%I.%I', c.table_schema, c.table_name)
  into v_item_table
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.column_name = 'approved_quantity'
    and exists (select 1 from information_schema.columns x where x.table_schema=c.table_schema and x.table_name=c.table_name and x.column_name='id')
    and exists (select 1 from information_schema.columns x where x.table_schema=c.table_schema and x.table_name=c.table_name and x.column_name='order_id')
  order by case when c.table_name ilike '%smart%purchase%item%' then 0 when c.table_name ilike '%purchase%item%' then 1 else 2 end
  limit 1;

  if v_item_table is null then
    return jsonb_build_object('ok', false, 'error', 'items_table_not_found');
  end if;

  select count(*) into v_expected from jsonb_array_elements(p_items);

  v_sql := format($f$
    with plan as (
      select (x->>'id')::uuid as id,
             greatest(0, floor(coalesce((x->>'approved_quantity')::numeric, 0))) as qty
      from jsonb_array_elements($1) x
    ), updated as (
      update %s i
      set approved_quantity = p.qty
      from plan p
      where i.id = p.id and i.order_id = $2
      returning i.id
    )
    select count(*) from updated
  $f$, v_item_table);

  execute v_sql into v_updated using p_items, p_order_id;

  if v_updated <> v_expected then
    raise exception 'budget_plan_partial_update: expected %, updated %', v_expected, v_updated;
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('updated', v_updated));
exception when others then
  return jsonb_build_object('ok', false, 'error', 'apply_failed', 'message', sqlerrm);
end;
$$;

grant execute on function public.smart_purchase_apply_budget_plan(text, uuid, jsonb) to anon, authenticated;

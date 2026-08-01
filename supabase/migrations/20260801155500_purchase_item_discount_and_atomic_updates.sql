do $$
declare
  v_item_table text;
begin
  select format('%I.%I', c.table_schema, c.table_name)
  into v_item_table
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.column_name = 'approved_quantity'
    and exists (
      select 1 from information_schema.columns x
      where x.table_schema = c.table_schema
        and x.table_name = c.table_name
        and x.column_name = 'id'
    )
    and exists (
      select 1 from information_schema.columns x
      where x.table_schema = c.table_schema
        and x.table_name = c.table_name
        and x.column_name = 'order_id'
    )
  order by case
    when c.table_name ilike '%smart%purchase%item%' then 0
    when c.table_name ilike '%purchase%item%' then 1
    else 2
  end
  limit 1;

  if v_item_table is null then
    raise exception 'purchase items table not found';
  end if;

  execute format(
    'alter table %s add column if not exists expected_discount numeric(5,2) not null default 20',
    v_item_table
  );

  execute format(
    'update %s set expected_discount = 20 where expected_discount is null or expected_discount = 0',
    v_item_table
  );
end;
$$;

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
  v_auth jsonb;
  v_item_table text;
  v_sql text;
  v_set_parts text[] := array[]::text[];
  v_updated integer := 0;
  v_submitted integer := 0;
  v_has_discount boolean := false;
  v_has_price boolean := false;
  v_has_supplier boolean := false;
begin
  perform set_config('statement_timeout', '20000', true);

  if coalesce(trim(p_session_token), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  begin
    select public.smart_purchase_unified(
      p_session_token,
      'dashboard',
      '{}'::jsonb
    ) into v_auth;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_session', 'message', sqlerrm);
  end;

  if coalesce((v_auth->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_auth->>'error', 'invalid_session'),
      'message', coalesce(v_auth->>'message', 'تعذر التحقق من الجلسة.')
    );
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  select format('%I.%I', c.table_schema, c.table_name)
  into v_item_table
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.column_name = 'approved_quantity'
    and exists (
      select 1 from information_schema.columns x
      where x.table_schema = c.table_schema
        and x.table_name = c.table_name
        and x.column_name = 'id'
    )
    and exists (
      select 1 from information_schema.columns x
      where x.table_schema = c.table_schema
        and x.table_name = c.table_name
        and x.column_name = 'order_id'
    )
  order by case
    when c.table_name ilike '%smart%purchase%item%' then 0
    when c.table_name ilike '%purchase%item%' then 1
    else 2
  end
  limit 1;

  if v_item_table is null then
    return jsonb_build_object('ok', false, 'error', 'items_table_not_found');
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = split_part(v_item_table, '.', 1)
      and table_name = split_part(v_item_table, '.', 2)
      and column_name = 'expected_discount'
  ) into v_has_discount;

  select exists (
    select 1 from information_schema.columns
    where table_schema = split_part(v_item_table, '.', 1)
      and table_name = split_part(v_item_table, '.', 2)
      and column_name = 'expected_unit_cost'
  ) into v_has_price;

  select exists (
    select 1 from information_schema.columns
    where table_schema = split_part(v_item_table, '.', 1)
      and table_name = split_part(v_item_table, '.', 2)
      and column_name = 'supplier_name'
  ) into v_has_supplier;

  v_set_parts := array_append(
    v_set_parts,
    'approved_quantity = case when p.has_quantity then greatest(0, floor(coalesce(p.approved_quantity, 0))) else i.approved_quantity end'
  );

  if v_has_discount then
    v_set_parts := array_append(
      v_set_parts,
      'expected_discount = case when p.has_discount then least(100, greatest(0, coalesce(p.expected_discount, 20))) else i.expected_discount end'
    );
  end if;

  if v_has_price then
    v_set_parts := array_append(
      v_set_parts,
      'expected_unit_cost = case when p.has_price then greatest(0, coalesce(p.expected_unit_cost, 0)) else i.expected_unit_cost end'
    );
  end if;

  if v_has_supplier then
    v_set_parts := array_append(
      v_set_parts,
      'supplier_name = case when p.has_supplier then coalesce(p.supplier_name, '''') else i.supplier_name end'
    );
  end if;

  select count(*) into v_submitted from jsonb_array_elements(p_items);
  if v_submitted = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_plan');
  end if;

  v_sql := format($f$
    with plan as materialized (
      select
        (x->>'id')::uuid as id,
        x ? 'approved_quantity' as has_quantity,
        case when x ? 'approved_quantity' then (x->>'approved_quantity')::numeric end as approved_quantity,
        x ? 'expected_discount' as has_discount,
        case when x ? 'expected_discount' then (x->>'expected_discount')::numeric end as expected_discount,
        x ? 'expected_unit_cost' as has_price,
        case when x ? 'expected_unit_cost' then (x->>'expected_unit_cost')::numeric end as expected_unit_cost,
        x ? 'supplier_name' as has_supplier,
        case when x ? 'supplier_name' then x->>'supplier_name' end as supplier_name
      from jsonb_array_elements($1) x
    ), updated as (
      update %s i
      set %s
      from plan p
      where i.id = p.id
        and i.order_id = $2
      returning i.id
    )
    select count(*) from updated
  $f$, v_item_table, array_to_string(v_set_parts, ', '));

  execute v_sql into v_updated using p_items, p_order_id;

  if v_updated <> v_submitted then
    raise exception 'purchase_item_partial_update: submitted %, updated %', v_submitted, v_updated;
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object('updated', v_updated, 'submitted', v_submitted)
  );
exception when others then
  return jsonb_build_object('ok', false, 'error', 'apply_failed', 'message', sqlerrm);
end;
$$;

grant execute on function public.smart_purchase_apply_budget_plan(text, uuid, jsonb)
to anon, authenticated;

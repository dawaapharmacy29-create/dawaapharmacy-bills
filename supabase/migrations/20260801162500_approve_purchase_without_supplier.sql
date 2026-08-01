create or replace function public.smart_purchase_approve_without_supplier(
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth jsonb;
  v_order_table text;
  v_item_table text;
  v_status_column text := 'status';
  v_has_approved_at boolean := false;
  v_active_items integer := 0;
  v_updated integer := 0;
  v_sql text;
begin
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

  select format('%I.%I', c.table_schema, c.table_name)
  into v_order_table
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.column_name = 'id'
    and exists (
      select 1 from information_schema.columns x
      where x.table_schema = c.table_schema
        and x.table_name = c.table_name
        and x.column_name = 'status'
    )
  order by case
    when c.table_name = 'smart_purchase_orders' then 0
    when c.table_name ilike '%smart%purchase%order%' then 1
    when c.table_name ilike '%purchase%order%' then 2
    else 9 end
  limit 1;

  select format('%I.%I', c.table_schema, c.table_name)
  into v_item_table
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.column_name = 'order_id'
    and exists (
      select 1 from information_schema.columns x
      where x.table_schema = c.table_schema
        and x.table_name = c.table_name
        and x.column_name = 'approved_quantity'
    )
  order by case
    when c.table_name = 'smart_purchase_order_items' then 0
    when c.table_name ilike '%smart%purchase%item%' then 1
    when c.table_name ilike '%purchase%item%' then 2
    else 9 end
  limit 1;

  if v_order_table is null then
    return jsonb_build_object('ok', false, 'error', 'order_table_not_found');
  end if;
  if v_item_table is null then
    return jsonb_build_object('ok', false, 'error', 'items_table_not_found');
  end if;

  v_sql := format(
    'select count(*) from %s where order_id = $1 and coalesce(approved_quantity, 0) > 0',
    v_item_table
  );
  execute v_sql into v_active_items using p_order_id;

  if v_active_items = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_order', 'message', 'لا توجد كميات معتمدة داخل الطلبية.');
  end if;

  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = split_part(v_order_table, '.', 1)
      and c.table_name = split_part(v_order_table, '.', 2)
      and c.column_name = 'approved_at'
  ) into v_has_approved_at;

  if v_has_approved_at then
    v_sql := format(
      'update %s set status = $1, approved_at = now() where id = $2 and status not in ($3, $4) returning 1',
      v_order_table
    );
    execute v_sql into v_updated using 'معتمدة', p_order_id, 'مغلقة', 'تمت مطابقة الفاتورة';
  else
    v_sql := format(
      'update %s set status = $1 where id = $2 and status not in ($3, $4) returning 1',
      v_order_table
    );
    execute v_sql into v_updated using 'معتمدة', p_order_id, 'مغلقة', 'تمت مطابقة الفاتورة';
  end if;

  if coalesce(v_updated, 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'id', p_order_id,
      'status', 'معتمدة',
      'active_items', v_active_items,
      'supplier_required', false
    )
  );
exception when others then
  return jsonb_build_object('ok', false, 'error', 'approve_failed', 'message', sqlerrm);
end;
$$;

grant execute on function public.smart_purchase_approve_without_supplier(text, uuid)
to anon, authenticated;

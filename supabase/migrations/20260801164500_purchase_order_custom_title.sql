create or replace function public.smart_purchase_update_order_title(
  p_session_token text,
  p_order_id uuid,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth jsonb;
  v_order_table text;
  v_title_column text;
  v_title text := trim(coalesce(p_title, ''));
  v_sql text;
  v_updated integer := 0;
begin
  if coalesce(trim(p_session_token), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  if char_length(v_title) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid_title', 'message', 'اسم الطلبية يجب ألا يقل عن حرفين.');
  end if;

  if char_length(v_title) > 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_title', 'message', 'اسم الطلبية طويل جدًا.');
  end if;

  begin
    select public.smart_purchase_unified(p_session_token, 'dashboard', '{}'::jsonb)
    into v_auth;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_session', 'message', sqlerrm);
  end;

  if coalesce((v_auth->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', coalesce(v_auth->>'error', 'invalid_session'));
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
        and x.column_name = 'order_number'
    )
  order by case
    when c.table_name = 'smart_purchase_orders' then 0
    when c.table_name ilike '%smart%purchase%order%' then 1
    when c.table_name ilike '%purchase%order%' then 2
    else 9 end
  limit 1;

  if v_order_table is null then
    return jsonb_build_object('ok', false, 'error', 'order_table_not_found');
  end if;

  select c.column_name
  into v_title_column
  from information_schema.columns c
  where format('%I.%I', c.table_schema, c.table_name) = v_order_table
    and c.column_name in ('title', 'name', 'order_title')
  order by case c.column_name when 'title' then 0 when 'order_title' then 1 else 2 end
  limit 1;

  if v_title_column is null then
    return jsonb_build_object('ok', false, 'error', 'title_column_not_found');
  end if;

  v_sql := format('update %s set %I = $1 where id = $2 returning 1', v_order_table, v_title_column);
  execute v_sql into v_updated using v_title, p_order_id;

  if coalesce(v_updated, 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('id', p_order_id, 'title', v_title));
exception when others then
  return jsonb_build_object('ok', false, 'error', 'update_title_failed', 'message', sqlerrm);
end;
$$;

grant execute on function public.smart_purchase_update_order_title(text, uuid, text)
to anon, authenticated;

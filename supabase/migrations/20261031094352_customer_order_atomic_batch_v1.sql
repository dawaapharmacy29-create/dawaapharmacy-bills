-- Additive, fail-closed batch creation. Legacy CustomerOrder rows remain unchanged.
alter table public.customer_orders add column if not exists order_group_id uuid;
alter table public.customer_orders add column if not exists group_size integer;
alter table public.customer_orders add column if not exists line_no integer;
alter table public.customer_orders add column if not exists product_code text;
alter table public.customer_orders add column if not exists quantity integer;
alter table public.customer_orders add column if not exists unit text;
alter table public.customer_orders add column if not exists needed_by_date date;
alter table public.customer_orders add column if not exists needed_time text;
alter table public.customer_orders add column if not exists important_customer boolean;
alter table public.customer_orders add column if not exists recorded_by_id text;
alter table public.customer_orders add column if not exists recorded_by text;
alter table public.customer_orders add column if not exists general_notes text;
alter table public.customer_orders add column if not exists fulfilled_quantity integer;
alter table public.customer_orders add column if not exists alternative_accepted boolean;

create unique index if not exists customer_orders_batch_line_uq on public.customer_orders(order_group_id, line_no) where order_group_id is not null;
create index if not exists customer_orders_warehouse_date_idx on public.customer_orders(needed_by_date, branch) where order_group_id is not null;
create sequence if not exists public.customer_order_public_number_seq start with 1001;

create or replace function public.app_customer_order_batch_create_v1(
  p_session_token text,
  p_request_id uuid,
  p_order jsonb,
  p_lines jsonb
) returns jsonb
language plpgsql security definer
set search_path = 'public', 'extensions'
as $function$
declare
  v_account record;
  v_doctor record;
  v_existing record;
  v_branch text;
  v_number text;
  v_item jsonb;
  v_index integer := 0;
  v_count integer;
  v_name text;
  v_unit text;
  v_qty integer;
  v_date date;
  v_time text;
  v_customer text;
  v_phone text;
  v_source text;
begin
  if p_request_id is null or p_order is null or jsonb_typeof(p_order) <> 'object' or jsonb_typeof(p_lines) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  select a.id, a.role, a.display_name, a.branch_ids into v_account
  from public.staff_sessions s join public.staff_accounts a on a.id=s.account_id
  where s.token_hash=encode(digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>now() and a.status='active'
  limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  v_branch := p_order->>'branch';
  if v_branch not in ('دواء شكري','دواء الشامي') then
    return jsonb_build_object('ok', false, 'error', 'invalid_branch');
  end if;
  if v_account.role <> 'general_manager' and not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_account.branch_ids, '[]'::jsonb)) x(value) where x.value=v_branch
  ) then return jsonb_build_object('ok', false, 'error', 'forbidden_branch'); end if;

  -- A stable request UUID makes retries safe even after a response timeout.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select order_number, count(*) as amount into v_existing
    from public.customer_orders where order_group_id=p_request_id
    group by order_number limit 1;
  if found then
    return jsonb_build_object('ok',true,'data',jsonb_build_object('order_number',v_existing.order_number,'order_group_id',p_request_id,'group_size',v_existing.amount,'already_saved',true));
  end if;

  v_count := jsonb_array_length(p_lines);
  if v_count < 1 or v_count > 30 then return jsonb_build_object('ok',false,'error','invalid_line_count'); end if;
  v_customer := nullif(trim(coalesce(p_order->>'customer_name','')),'');
  v_phone := nullif(trim(coalesce(p_order->>'phone','')),'');
  v_source := p_order->>'request_source';
  if v_customer is null or v_phone is null or v_phone !~ '^01(0|1|2|5)[0-9]{8}$' or
     coalesce(p_order->>'customer_code','') = '' or
     v_source not in ('واتساب','داخل الصيدلية','مكالمة هاتفية') then
    return jsonb_build_object('ok',false,'error','invalid_customer');
  end if;
  if coalesce(p_order->>'needed_by_date','') !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object('ok',false,'error','invalid_needed_date');
  end if;
  v_date := (p_order->>'needed_by_date')::date;
  v_time := coalesce(p_order->>'needed_time','');
  if v_time not in ('','صباحًا','مساءً') then return jsonb_build_object('ok',false,'error','invalid_time'); end if;

  select id,name into v_doctor from public.team_members
  where id::text = p_order->>'recorded_by_id'
    and role in ('صيدلي','طبيب') and is_active is distinct from false
    and branches @> jsonb_build_array(v_branch)
    and merged_into_id is null
  limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_doctor_branch'); end if;

  -- Validate every line before inserting any. Any unexpected error rolls back the whole function.
  for v_item in select value from jsonb_array_elements(p_lines) loop
    v_name := trim(coalesce(v_item->>'product_name',''));
    v_unit := v_item->>'unit';
    if jsonb_typeof(v_item->'quantity') not in ('number','string') or
      coalesce(v_item->>'quantity','') !~ '^[0-9]{1,5}$' then
      return jsonb_build_object('ok',false,'error','invalid_quantity');
    end if;
    v_qty := (v_item->>'quantity')::integer;
    if length(v_name) < 2 or length(v_name) > 220 or v_qty < 1 or v_qty > 9999 or
       v_unit not in ('علبة','شريط','زجاجة','أمبول','فيال','كيس','قطعة') then
      return jsonb_build_object('ok',false,'error','invalid_line');
    end if;
    if coalesce((v_item->>'alternative_accepted')::boolean,false) then
      return jsonb_build_object('ok',false,'error','alternative_requires_review');
    end if;
  end loop;

  v_number := 'D-' || nextval('public.customer_order_public_number_seq')::text;
  for v_item in select value from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;
    insert into public.customer_orders(
      id, order_number, order_group_id, group_size, line_no, request_date,
      customer_name, customer_code, phone, branch, product_name, product_code, quantity, unit,
      priority, status, request_source, needed_by_date, needed_time, important_customer,
      recorded_by_id, recorded_by, general_notes, notes, alternative_accepted, fulfilled_quantity,
      created_at, updated_at, created_by_id, created_by, is_sample, source_system, timeline
    ) values (
      gen_random_uuid()::text, v_number, p_request_id, v_count, v_index,
      (now() at time zone 'Africa/Cairo')::date, v_customer, p_order->>'customer_code', v_phone,
      v_branch, trim(v_item->>'product_name'), nullif(v_item->>'product_code',''),
      (v_item->>'quantity')::integer, v_item->>'unit',
      case when coalesce((p_order->>'urgent')::boolean,false) then 'عاجل' else 'عادي' end,
      'طلب جديد', v_source, v_date, nullif(v_time,''),
      coalesce((p_order->>'important_customer')::boolean,false),
      v_doctor.id::text, v_doctor.name, p_order->>'general_notes', v_item->>'notes', false, 0,
      now(), now(), v_account.id::text, v_account.display_name, false, 'supabase',
      jsonb_build_array(jsonb_build_object('status','طلب جديد','by',v_account.display_name,'at',now(),'note','سجل الطلب للدكتور '||v_doctor.name))
    );
  end loop;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('order_number',v_number,'order_group_id',p_request_id,'group_size',v_count,'already_saved',false));
end;
$function$;

revoke all on function public.app_customer_order_batch_create_v1(text,uuid,jsonb,jsonb) from public;
grant execute on function public.app_customer_order_batch_create_v1(text,uuid,jsonb,jsonb) to anon, authenticated, service_role;

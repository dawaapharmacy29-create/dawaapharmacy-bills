-- Persistent shortage registry for purchase sourcing.
-- A shortage event is created only when the user explicitly records the remaining
-- branch demand as a shortage after supplier sourcing attempts.
-- Later allocation/receipt changes update the current shortage without erasing
-- the historical occurrence.

create table if not exists public.purchase_shortage_events (
  id uuid primary key default gen_random_uuid(),
  branch text not null,
  product_key text not null,
  product_code text null,
  product_name text not null,
  order_id uuid null references public.smart_purchase_orders(id) on delete set null,
  order_item_id uuid null references public.smart_purchase_order_items(id) on delete set null,
  requested_quantity numeric not null default 0 check (requested_quantity >= 0),
  initial_allocated_quantity numeric not null default 0 check (initial_allocated_quantity >= 0),
  initial_received_quantity numeric not null default 0 check (initial_received_quantity >= 0),
  initial_shortage_quantity numeric not null default 0 check (initial_shortage_quantity >= 0),
  current_allocated_quantity numeric not null default 0 check (current_allocated_quantity >= 0),
  current_received_quantity numeric not null default 0 check (current_received_quantity >= 0),
  current_shortage_quantity numeric not null default 0 check (current_shortage_quantity >= 0),
  shortage_basis text not null default 'sourcing' check (shortage_basis in ('sourcing','receipt')),
  initial_shortage_type text not null check (initial_shortage_type in ('unavailable','limited_supply')),
  current_shortage_type text not null check (current_shortage_type in ('unavailable','limited_supply','covered_later')),
  status text not null default 'open' check (status in ('open','covered_later','superseded')),
  created_by_account_id uuid null,
  created_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchase_shortage_events_order_item_uidx
  on public.purchase_shortage_events(order_item_id)
  where order_item_id is not null;

create index if not exists purchase_shortage_events_branch_product_idx
  on public.purchase_shortage_events(branch,product_key,created_at desc);

create index if not exists purchase_shortage_events_open_idx
  on public.purchase_shortage_events(branch,status,current_shortage_quantity desc)
  where status='open';

alter table public.purchase_shortage_events enable row level security;
revoke all on table public.purchase_shortage_events from public,anon,authenticated;

create or replace function public.smart_purchase_shortage_product_key_v1(
  p_product_code text,
  p_product_name text
)
returns text
language sql
immutable
set search_path='pg_catalog'
as $
  select case
    when nullif(trim(coalesce(p_product_code,'')),'') is not null
      then 'code:'||lower(regexp_replace(trim(p_product_code),'\.0+$','','g'))
    else 'name:'||lower(regexp_replace(trim(coalesce(p_product_name,'')),'[[:space:]]+',' ','g'))
  end
$$;

revoke all on function public.smart_purchase_shortage_product_key_v1(text,text) from public,anon,authenticated;

create or replace function public.smart_purchase_sync_shortage_event_for_item_v1(
  p_order_item_id uuid
)
returns void
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  i public.smart_purchase_order_items%rowtype;
  v_basis text:='sourcing';
  v_requested numeric:=0;
  v_allocated numeric:=0;
  v_received numeric:=0;
  v_shortage numeric:=0;
  v_coverage numeric:=0;
begin
  if p_order_item_id is null then
    return;
  end if;

  select * into i
  from public.smart_purchase_order_items
  where id=p_order_item_id;

  if not found then
    return;
  end if;

  select e.shortage_basis
  into v_basis
  from public.purchase_shortage_events e
  where e.order_item_id=p_order_item_id
  limit 1;

  if not found then
    return;
  end if;

  v_requested:=greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0));

  select
    coalesce(sum(greatest(0,x.allocated_quantity)),0),
    coalesce(sum(greatest(0,x.received_quantity)),0)
  into v_allocated,v_received
  from public.purchase_order_supplier_allocations x
  where x.order_item_id=p_order_item_id;

  v_allocated:=least(v_requested,greatest(0,v_allocated));
  v_received:=least(v_requested,greatest(0,v_received));
  v_coverage:=case when v_basis='receipt' then v_received else v_allocated end;
  v_shortage:=greatest(0,v_requested-v_coverage);

  update public.purchase_shortage_events e
  set requested_quantity=v_requested,
      current_allocated_quantity=v_allocated,
      current_received_quantity=v_received,
      current_shortage_quantity=v_shortage,
      current_shortage_type=case
        when v_shortage<=0 then 'covered_later'
        when v_coverage<=0 then 'unavailable'
        else 'limited_supply'
      end,
      status=case
        when e.status='superseded' then 'superseded'
        when v_shortage<=0 then 'covered_later'
        else 'open'
      end,
      updated_at=now()
  where e.order_item_id=p_order_item_id;
end
$$;

revoke all on function public.smart_purchase_sync_shortage_event_for_item_v1(uuid) from public,anon,authenticated;

create or replace function public.smart_purchase_ensure_receipt_shortage_event_v1(
  p_order_item_id uuid
)
returns void
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  i public.smart_purchase_order_items%rowtype;
  o public.smart_purchase_orders%rowtype;
  v_requested numeric:=0;
  v_allocated numeric:=0;
  v_received numeric:=0;
  v_shortage numeric:=0;
  v_key text;
begin
  if p_order_item_id is null then
    return;
  end if;

  select * into i
  from public.smart_purchase_order_items
  where id=p_order_item_id;

  if not found then
    return;
  end if;

  select * into o
  from public.smart_purchase_orders
  where id=i.order_id;

  if not found then
    return;
  end if;

  v_requested:=greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0));

  select
    coalesce(sum(greatest(0,x.allocated_quantity)),0),
    coalesce(sum(greatest(0,x.received_quantity)),0)
  into v_allocated,v_received
  from public.purchase_order_supplier_allocations x
  where x.order_item_id=i.id;

  v_allocated:=least(v_requested,greatest(0,v_allocated));
  v_received:=least(v_requested,greatest(0,v_received));
  v_shortage:=greatest(0,v_requested-v_received);
  v_key:=public.smart_purchase_shortage_product_key_v1(i.product_code,i.product_name);

  if exists(
    select 1 from public.purchase_shortage_events e
    where e.order_item_id=i.id
  ) then
    update public.purchase_shortage_events e
    set shortage_basis='receipt',
        branch=o.branch,
        product_key=v_key,
        product_code=i.product_code,
        product_name=i.product_name,
        updated_at=now()
    where e.order_item_id=i.id;

    perform public.smart_purchase_sync_shortage_event_for_item_v1(i.id);
    return;
  end if;

  if v_shortage<=0 then
    return;
  end if;

  update public.purchase_shortage_events previous
  set status='superseded',
      updated_at=now()
  where previous.branch=o.branch
    and previous.product_key=v_key
    and previous.order_item_id is distinct from i.id
    and previous.status='open';

  insert into public.purchase_shortage_events(
    branch,product_key,product_code,product_name,
    order_id,order_item_id,
    requested_quantity,
    initial_allocated_quantity,initial_received_quantity,initial_shortage_quantity,
    current_allocated_quantity,current_received_quantity,current_shortage_quantity,
    shortage_basis,initial_shortage_type,current_shortage_type,status
  )
  values(
    o.branch,v_key,i.product_code,i.product_name,
    o.id,i.id,
    v_requested,
    v_allocated,v_received,v_shortage,
    v_allocated,v_received,v_shortage,
    'receipt',
    case when v_received<=0 then 'unavailable' else 'limited_supply' end,
    case when v_received<=0 then 'unavailable' else 'limited_supply' end,
    'open'
  );
end
$$;

revoke all on function public.smart_purchase_ensure_receipt_shortage_event_v1(uuid) from public,anon,authenticated;

create or replace function public.purchase_shortage_allocation_sync_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
begin
  if tg_op='DELETE' then
    perform public.smart_purchase_sync_shortage_event_for_item_v1(old.order_item_id);
    return old;
  end if;

  if tg_op='UPDATE' and coalesce(new.received_quantity,0)>coalesce(old.received_quantity,0) then
    perform public.smart_purchase_ensure_receipt_shortage_event_v1(new.order_item_id);
  else
    perform public.smart_purchase_sync_shortage_event_for_item_v1(new.order_item_id);
  end if;

  if tg_op='UPDATE' and old.order_item_id is distinct from new.order_item_id then
    perform public.smart_purchase_sync_shortage_event_for_item_v1(old.order_item_id);
  end if;

  return new;
end
$$;

revoke all on function public.purchase_shortage_allocation_sync_trigger_v1() from public,anon,authenticated;

drop trigger if exists purchase_shortage_allocation_sync_v1
  on public.purchase_order_supplier_allocations;

create trigger purchase_shortage_allocation_sync_v1
after insert or update of allocated_quantity,received_quantity,order_item_id or delete
on public.purchase_order_supplier_allocations
for each row execute function public.purchase_shortage_allocation_sync_trigger_v1();

create or replace function public.smart_purchase_shortage_registry_v1(
  p_session_token text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  a record;
  o public.smart_purchase_orders%rowtype;
  i public.smart_purchase_order_items%rowtype;
  v_order_id uuid;
  v_requested numeric:=0;
  v_allocated numeric:=0;
  v_received numeric:=0;
  v_shortage numeric:=0;
  v_basis text:='sourcing';
  v_coverage numeric:=0;
  v_key text;
  v_created integer:=0;
  v_existing integer:=0;
  v_rows jsonb:='[]'::jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null
    and ss.expires_at>now()
    and sa.status='active'
  order by ss.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if p_action='register_order' then
    v_order_id:=nullif(p_payload->>'order_id','')::uuid;

    select * into o
    from public.smart_purchase_orders
    where id=v_order_id;

    if not found then
      return jsonb_build_object('ok',false,'error','order_not_found');
    end if;

    if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;

    if not exists(
      select 1
      from public.smart_purchase_workflow_snapshots ws
      where ws.order_id=v_order_id
        and ws.workflow_type='supplier_response'
        and coalesce(ws.summary->>'scope','')='branch_remaining_v1'
    ) then
      return jsonb_build_object('ok',false,'error','supplier_response_required');
    end if;

    for i in
      select *
      from public.smart_purchase_order_items oi
      where oi.order_id=v_order_id
        and greatest(0,coalesce(oi.approved_quantity,oi.requested_quantity,0))>0
      order by oi.product_name
    loop
      v_requested:=greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0));

      select
        coalesce(sum(greatest(0,x.allocated_quantity)),0),
        coalesce(sum(greatest(0,x.received_quantity)),0)
      into v_allocated,v_received
      from public.purchase_order_supplier_allocations x
      where x.order_item_id=i.id;

      v_allocated:=least(v_requested,greatest(0,v_allocated));
      v_received:=least(v_requested,greatest(0,v_received));
      v_basis:=case when v_received>0 then 'receipt' else 'sourcing' end;
      v_coverage:=case when v_basis='receipt' then v_received else v_allocated end;
      v_shortage:=greatest(0,v_requested-v_coverage);

      if v_shortage<=0 then
        continue;
      end if;

      v_key:=public.smart_purchase_shortage_product_key_v1(i.product_code,i.product_name);

      update public.purchase_shortage_events previous
      set status='superseded',
          updated_at=now()
      where previous.branch=o.branch
        and previous.product_key=v_key
        and previous.order_item_id is distinct from i.id
        and previous.status='open';

      if exists(
        select 1 from public.purchase_shortage_events e
        where e.order_item_id=i.id
      ) then
        update public.purchase_shortage_events e
        set branch=o.branch,
            product_key=v_key,
            product_code=i.product_code,
            product_name=i.product_name,
            requested_quantity=v_requested,
            current_allocated_quantity=v_allocated,
            current_received_quantity=v_received,
            current_shortage_quantity=v_shortage,
            shortage_basis=v_basis,
            current_shortage_type=case when v_coverage<=0 then 'unavailable' else 'limited_supply' end,
            status='open',
            updated_at=now()
        where e.order_item_id=i.id;
        v_existing:=v_existing+1;
      else
        insert into public.purchase_shortage_events(
          branch,product_key,product_code,product_name,
          order_id,order_item_id,
          requested_quantity,
          initial_allocated_quantity,initial_received_quantity,initial_shortage_quantity,
          current_allocated_quantity,current_received_quantity,current_shortage_quantity,
          shortage_basis,initial_shortage_type,current_shortage_type,status,
          created_by_account_id,created_by_name
        )
        values(
          o.branch,v_key,i.product_code,i.product_name,
          o.id,i.id,
          v_requested,
          v_allocated,v_received,v_shortage,
          v_allocated,v_received,v_shortage,
          v_basis,
          case when v_coverage<=0 then 'unavailable' else 'limited_supply' end,
          case when v_coverage<=0 then 'unavailable' else 'limited_supply' end,
          'open',
          a.id,a.display_name
        );
        v_created:=v_created+1;
      end if;
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id',e.id,
      'product_key',e.product_key,
      'product_code',e.product_code,
      'product_name',e.product_name,
      'requested_quantity',e.requested_quantity,
      'allocated_quantity',e.current_allocated_quantity,
      'received_quantity',e.current_received_quantity,
      'shortage_quantity',e.current_shortage_quantity,
      'shortage_type',e.current_shortage_type,
      'status',e.status
    ) order by e.product_name),'[]'::jsonb)
    into v_rows
    from public.purchase_shortage_events e
    where e.order_id=v_order_id
      and e.status='open'
      and e.current_shortage_quantity>0;

    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'order_id',v_order_id,
      'branch',o.branch,
      'created',v_created,
      'existing',v_existing,
      'shortage_items',jsonb_array_length(v_rows),
      'shortage_quantity',coalesce((
        select sum(e.current_shortage_quantity)
        from public.purchase_shortage_events e
        where e.order_id=v_order_id
          and e.status='open'
      ),0),
      'items',v_rows
    ));

  elsif p_action='list' then
    return jsonb_build_object('ok',true,'data',coalesce((
      with allowed_events as (
        select e.*
        from public.purchase_shortage_events e
        where public.smart_purchase_branch_allowed_v2(a.id,e.branch)
      ),
      grouped as (
        select
          e.branch,
          e.product_key,
          count(*)::int as shortage_occurrences,
          count(*) filter(where e.initial_shortage_type='unavailable')::int as unavailable_occurrences,
          count(*) filter(where e.initial_shortage_type='limited_supply')::int as limited_supply_occurrences,
          count(*) filter(where e.status='open')::int as open_events,
          coalesce(sum(e.requested_quantity),0) as total_requested_quantity,
          coalesce(sum(e.initial_allocated_quantity),0) as total_initial_allocated_quantity,
          coalesce(sum(e.current_received_quantity),0) as total_received_quantity,
          coalesce(sum(e.current_shortage_quantity) filter(where e.status='open'),0) as open_shortage_quantity,
          min(e.created_at) as first_shortage_at,
          max(e.created_at) as last_shortage_at
        from allowed_events e
        group by e.branch,e.product_key
      )
      select jsonb_agg(jsonb_build_object(
        'branch',g.branch,
        'product_key',g.product_key,
        'product_code',latest.product_code,
        'product_name',latest.product_name,
        'shortage_occurrences',g.shortage_occurrences,
        'unavailable_occurrences',g.unavailable_occurrences,
        'limited_supply_occurrences',g.limited_supply_occurrences,
        'open_events',g.open_events,
        'total_requested_quantity',g.total_requested_quantity,
        'total_initial_allocated_quantity',g.total_initial_allocated_quantity,
        'total_received_quantity',g.total_received_quantity,
        'open_shortage_quantity',g.open_shortage_quantity,
        'supply_coverage_pct',case
          when g.total_requested_quantity>0
            then round(100*g.total_initial_allocated_quantity/g.total_requested_quantity,1)
          else 0 end,
        'received_coverage_pct',case
          when g.total_requested_quantity>0
            then round(100*g.total_received_quantity/g.total_requested_quantity,1)
          else 0 end,
        'is_recurring',g.shortage_occurrences>=2,
        'is_chronic',g.shortage_occurrences>=3
          or (g.shortage_occurrences>=2 and g.total_initial_allocated_quantity < g.total_requested_quantity*0.5),
        'has_limited_supply',g.limited_supply_occurrences>0,
        'current_status',case
          when g.open_shortage_quantity<=0 then 'covered_later'
          when latest.current_shortage_type='unavailable' then 'unavailable'
          else 'limited_supply'
        end,
        'first_shortage_at',g.first_shortage_at,
        'last_shortage_at',g.last_shortage_at,
        'last_order_id',latest.order_id,
        'last_order_status',(
          select lo.status
          from public.smart_purchase_orders lo
          where lo.id=latest.order_id
        ),
        'last_order_item_id',latest.order_item_id,
        'last_requested_quantity',latest.requested_quantity,
        'last_allocated_quantity',latest.current_allocated_quantity,
        'last_received_quantity',latest.current_received_quantity,
        'last_shortage_quantity',latest.current_shortage_quantity,
        'last_shortage_basis',latest.shortage_basis,
        'last_event_status',latest.status
      ) order by
        (g.open_shortage_quantity>0) desc,
        (g.shortage_occurrences>=2) desc,
        g.last_shortage_at desc)
      from grouped g
      join lateral (
        select e.*
        from allowed_events e
        where e.branch=g.branch and e.product_key=g.product_key
        order by e.created_at desc,e.id desc
        limit 1
      ) latest on true
    ),'[]'::jsonb));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end
$$;

revoke all on function public.smart_purchase_shortage_registry_v1(text,text,jsonb) from public;
grant execute on function public.smart_purchase_shortage_registry_v1(text,text,jsonb) to anon,authenticated;

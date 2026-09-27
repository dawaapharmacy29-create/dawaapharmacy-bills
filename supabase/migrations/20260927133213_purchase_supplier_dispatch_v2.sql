-- Track supplier-by-supplier dispatches and only move the order to sent when all suppliers were dispatched.
create table if not exists public.purchase_order_supplier_dispatches (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.smart_purchase_orders(id) on delete cascade,
  supplier_name text not null,
  sent_at timestamptz,
  sent_by_account_id uuid references public.staff_accounts(id),
  sent_by_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_supplier_dispatches_order_supplier_uidx unique(order_id,supplier_name)
);

alter table public.purchase_order_supplier_dispatches enable row level security;
revoke all on table public.purchase_order_supplier_dispatches from public,anon,authenticated;

create or replace function public.smart_purchase_supplier_dispatch_v2(
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
  v_order_id uuid;
  v_supplier text;
  v_order public.smart_purchase_orders%rowtype;
  v_required integer:=0;
  v_sent integer:=0;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  if v_order_id is null then return jsonb_build_object('ok',false,'error','order_required'); end if;

  select * into v_order from public.smart_purchase_orders where id=v_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;

  if p_action='list' then
    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'suppliers',coalesce((
        select jsonb_agg(jsonb_build_object(
          'supplier_name',x.supplier_name,
          'items_count',x.items_count,
          'total_value',x.total_value,
          'sent_at',d.sent_at,
          'sent_by_name',d.sent_by_name,
          'sent',d.sent_at is not null
        ) order by x.supplier_name)
        from (
          select trim(i.supplier_name) supplier_name,
                 count(*) items_count,
                 sum(coalesce(i.approved_quantity,0)*coalesce(i.expected_unit_cost,0)) total_value
          from public.smart_purchase_order_items i
          where i.order_id=v_order_id
            and coalesce(i.approved_quantity,0)>0
            and nullif(trim(coalesce(i.supplier_name,'')),'') is not null
          group by trim(i.supplier_name)
        ) x
        left join public.purchase_order_supplier_dispatches d
          on d.order_id=v_order_id and lower(trim(d.supplier_name))=lower(trim(x.supplier_name))
      ),'[]'::jsonb)
    ));

  elsif p_action='mark_supplier_sent' then
    if a.role not in ('general_manager','branch_manager','purchasing') then
      return jsonb_build_object('ok',false,'error','forbidden');
    end if;
    if v_order.status not in ('معتمدة','تم الإرسال للمورد') then
      return jsonb_build_object('ok',false,'error','order_not_ready_to_send','status',v_order.status);
    end if;

    v_supplier:=nullif(trim(p_payload->>'supplier_name'),'');
    if v_supplier is null then return jsonb_build_object('ok',false,'error','supplier_required'); end if;

    if not exists(
      select 1 from public.smart_purchase_order_items
      where order_id=v_order_id and coalesce(approved_quantity,0)>0
        and lower(trim(coalesce(supplier_name,'')))=lower(trim(v_supplier))
    ) then
      return jsonb_build_object('ok',false,'error','supplier_not_in_order');
    end if;

    insert into public.purchase_order_supplier_dispatches(
      order_id,supplier_name,sent_at,sent_by_account_id,sent_by_name,created_at,updated_at
    ) values (
      v_order_id,v_supplier,now(),a.id,a.display_name,now(),now()
    )
    on conflict(order_id,supplier_name) do update set
      sent_at=excluded.sent_at,
      sent_by_account_id=excluded.sent_by_account_id,
      sent_by_name=excluded.sent_by_name,
      updated_at=now();

    select count(distinct lower(trim(i.supplier_name))) into v_required
    from public.smart_purchase_order_items i
    where i.order_id=v_order_id and coalesce(i.approved_quantity,0)>0
      and nullif(trim(coalesce(i.supplier_name,'')),'') is not null;

    select count(distinct lower(trim(d.supplier_name))) into v_sent
    from public.purchase_order_supplier_dispatches d
    where d.order_id=v_order_id and d.sent_at is not null;

    if v_required>0 and v_sent>=v_required then
      update public.smart_purchase_orders
      set status='تم الإرسال للمورد',
          sent_at=coalesce(sent_at,now()),
          sent_by_name=a.display_name,
          updated_at=now()
      where id=v_order_id;
    end if;

    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'supplier_name',v_supplier,
      'required_suppliers',v_required,
      'sent_suppliers',v_sent,
      'all_sent',(v_required>0 and v_sent>=v_required)
    ));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $$;

revoke all on function public.smart_purchase_supplier_dispatch_v2(text,text,jsonb) from public;
grant execute on function public.smart_purchase_supplier_dispatch_v2(text,text,jsonb) to anon,authenticated;

-- Actual supplier allocations for the current purchase journey.
-- Keeps historical supplier_name on smart_purchase_order_items unchanged.
-- New supplier-response flow can split one order item across multiple suppliers.

create table if not exists public.purchase_order_supplier_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.smart_purchase_orders(id) on delete cascade,
  order_item_id uuid not null references public.smart_purchase_order_items(id) on delete cascade,
  supplier_name text not null,
  allocated_quantity numeric not null default 0 check (allocated_quantity >= 0),
  received_quantity numeric not null default 0 check (received_quantity >= 0),
  source_snapshot_id uuid null references public.smart_purchase_workflow_snapshots(id) on delete set null,
  created_by_account_id uuid null,
  created_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchase_order_supplier_allocations_order_item_supplier_uidx
  on public.purchase_order_supplier_allocations(
    order_id,
    order_item_id,
    lower(trim(supplier_name))
  );

create index if not exists purchase_order_supplier_allocations_order_supplier_idx
  on public.purchase_order_supplier_allocations(order_id, lower(trim(supplier_name)));

alter table public.purchase_order_supplier_allocations enable row level security;
revoke all on table public.purchase_order_supplier_allocations from public, anon, authenticated;

create or replace function public.smart_purchase_save_supplier_response_v1(
  p_session_token text,
  p_payload jsonb
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
  v_supplier text;
  v_supplier_key text;
  v_response_type text;
  v_file_name text;
  v_summary jsonb;
  v_details jsonb;
  v_snapshot_id uuid;
  v_existing_snapshot uuid;
  v_existing_response_type text;
  v_existing_details jsonb;
  v_item_id uuid;
  v_confirmed numeric;
  v_other_allocated numeric;
  v_current_received numeric;
  v_capacity numeric;
  r record;
  v_dispatch_id uuid;
  v_snapshot_items jsonb;
  v_snapshot_qty numeric:=0;
  v_snapshot_total numeric:=0;
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

  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  v_supplier:=nullif(trim(p_payload->>'supplier_name'),'');
  v_supplier_key:=lower(trim(coalesce(v_supplier,'')));
  v_response_type:=nullif(trim(p_payload->>'response_type'),'');
  v_file_name:=nullif(trim(p_payload->>'file_name'),'');
  v_summary:=coalesce(p_payload->'summary','{}'::jsonb)
    || jsonb_build_object('scope','branch_remaining_v1','allocation_source','supplier_response_v1');
  v_details:=coalesce(p_payload->'details','{}'::jsonb);

  if v_order_id is null then
    return jsonb_build_object('ok',false,'error','order_not_found');
  end if;
  if v_supplier is null then
    return jsonb_build_object('ok',false,'error','supplier_required');
  end if;
  if jsonb_typeof(coalesce(v_details->'details','[]'::jsonb))<>'array' then
    return jsonb_build_object('ok',false,'error','invalid_supplier_response');
  end if;

  select * into o
  from public.smart_purchase_orders
  where id=v_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','order_not_found');
  end if;

  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  if coalesce(o.status,'') not in (
    'معتمدة','تم الإرسال للمورد','approved','sent',
    'partially_received','وصلت جزئيًا','received','وصلت بالكامل'
  ) then
    return jsonb_build_object('ok',false,'error','supplier_response_order_not_ready','status',o.status);
  end if;

  if exists(
    select 1 from public.purchase_order_receipts r where r.order_id=v_order_id
  ) and not exists(
    select 1 from public.purchase_order_supplier_allocations x where x.order_id=v_order_id
  ) then
    return jsonb_build_object('ok',false,'error','supplier_allocation_requires_pre_receiving');
  end if;

  perform pg_advisory_xact_lock(hashtext(v_order_id::text||':supplier-response'));

  select ws.id,ws.response_type,ws.details
  into v_existing_snapshot,v_existing_response_type,v_existing_details
  from public.smart_purchase_workflow_snapshots ws
  where ws.order_id=v_order_id
    and ws.workflow_type='supplier_response'
    and lower(trim(coalesce(ws.supplier_name,'')))=v_supplier_key
    and coalesce(ws.summary->>'scope','')='branch_remaining_v1'
  order by ws.created_at desc,ws.id desc
  limit 1;

  if v_existing_snapshot is not null
     and coalesce(v_existing_response_type,'')=coalesce(v_response_type,'')
     and v_existing_details=v_details then
    return jsonb_build_object(
      'ok',true,
      'data',jsonb_build_object(
        'id',v_existing_snapshot,
        'order_id',v_order_id,
        'supplier_name',v_supplier,
        'idempotent',true,
        'allocations',coalesce((
          select jsonb_agg(to_jsonb(x) order by x.created_at,x.id)
          from public.purchase_order_supplier_allocations x
          where x.order_id=v_order_id
            and lower(trim(x.supplier_name))=v_supplier_key
        ),'[]'::jsonb)
      )
    );
  end if;

  for r in
    select
      nullif(x->'item'->>'id','')::uuid as item_id,
      sum(greatest(0,coalesce(nullif(x->>'confirmed','')::numeric,0))) as confirmed
    from jsonb_array_elements(coalesce(v_details->'details','[]'::jsonb)) x
    where nullif(x->'item'->>'id','') is not null
    group by 1
  loop
    v_item_id:=r.item_id;
    v_confirmed:=greatest(0,coalesce(r.confirmed,0));

    select * into i
    from public.smart_purchase_order_items
    where id=v_item_id and order_id=v_order_id
    for update;

    if not found then
      return jsonb_build_object('ok',false,'error','invalid_supplier_response_item','item_id',v_item_id);
    end if;

    select coalesce(sum(x.allocated_quantity),0)
    into v_other_allocated
    from public.purchase_order_supplier_allocations x
    where x.order_id=v_order_id
      and x.order_item_id=v_item_id
      and lower(trim(x.supplier_name))<>v_supplier_key;

    select coalesce(max(x.received_quantity),0)
    into v_current_received
    from public.purchase_order_supplier_allocations x
    where x.order_id=v_order_id
      and x.order_item_id=v_item_id
      and lower(trim(x.supplier_name))=v_supplier_key;

    v_capacity:=greatest(0,greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0))-v_other_allocated);

    if v_confirmed>v_capacity+0.0001 then
      return jsonb_build_object(
        'ok',false,
        'error','supplier_allocation_above_order',
        'item_id',v_item_id,
        'confirmed_quantity',v_confirmed,
        'available_capacity',v_capacity
      );
    end if;

    if v_confirmed+0.0001<v_current_received then
      return jsonb_build_object(
        'ok',false,
        'error','supplier_allocation_below_received',
        'item_id',v_item_id,
        'confirmed_quantity',v_confirmed,
        'already_received',v_current_received
      );
    end if;
  end loop;

  insert into public.smart_purchase_workflow_snapshots(
    order_id,workflow_type,response_type,supplier_name,file_name,summary,details
  )
  values(
    v_order_id,'supplier_response',v_response_type,v_supplier,v_file_name,v_summary,v_details
  )
  returning id into v_snapshot_id;

  delete from public.purchase_order_supplier_allocations x
  where x.order_id=v_order_id
    and lower(trim(x.supplier_name))=v_supplier_key
    and coalesce(x.received_quantity,0)=0;

  for r in
    select
      nullif(x->'item'->>'id','')::uuid as item_id,
      sum(greatest(0,coalesce(nullif(x->>'confirmed','')::numeric,0))) as confirmed
    from jsonb_array_elements(coalesce(v_details->'details','[]'::jsonb)) x
    where nullif(x->'item'->>'id','') is not null
    group by 1
  loop
    if coalesce(r.confirmed,0)>0 then
      update public.purchase_order_supplier_allocations x
      set allocated_quantity=greatest(coalesce(r.confirmed,0),coalesce(x.received_quantity,0)),
          source_snapshot_id=v_snapshot_id,
          created_by_account_id=coalesce(x.created_by_account_id,a.id),
          created_by_name=coalesce(x.created_by_name,a.display_name),
          updated_at=now()
      where x.order_id=v_order_id
        and x.order_item_id=r.item_id
        and lower(trim(x.supplier_name))=v_supplier_key;

      if not found then
        insert into public.purchase_order_supplier_allocations(
          order_id,order_item_id,supplier_name,allocated_quantity,received_quantity,
          source_snapshot_id,created_by_account_id,created_by_name
        )
        values(
          v_order_id,r.item_id,v_supplier,coalesce(r.confirmed,0),0,
          v_snapshot_id,a.id,a.display_name
        );
      end if;
    end if;
  end loop;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'order_item_id',x.order_item_id,
      'product_code',i.product_code,
      'product_name',i.product_name,
      'quantity',x.allocated_quantity
    ) order by i.product_name),'[]'::jsonb),
    coalesce(sum(x.allocated_quantity),0),
    coalesce(sum(x.allocated_quantity*greatest(0,coalesce(i.expected_unit_cost,0))),0)
  into v_snapshot_items,v_snapshot_qty,v_snapshot_total
  from public.purchase_order_supplier_allocations x
  join public.smart_purchase_order_items i on i.id=x.order_item_id
  where x.order_id=v_order_id
    and lower(trim(x.supplier_name))=v_supplier_key
    and x.allocated_quantity>0;

  select d.id into v_dispatch_id
  from public.purchase_order_supplier_dispatches d
  where d.order_id=v_order_id
    and lower(trim(d.supplier_name))=v_supplier_key
  order by d.created_at
  limit 1
  for update;

  if v_dispatch_id is null then
    insert into public.purchase_order_supplier_dispatches(
      order_id,supplier_name,sent_at,sent_by_account_id,sent_by_name,notes,
      snapshot_items,snapshot_items_count,snapshot_quantity,snapshot_total,
      snapshot_hash,snapshot_order_approved_at,created_at,updated_at
    )
    values(
      v_order_id,v_supplier,now(),a.id,a.display_name,
      'Confirmed by branch-wide supplier response',
      v_snapshot_items,jsonb_array_length(v_snapshot_items),v_snapshot_qty,v_snapshot_total,
      encode(extensions.digest(v_snapshot_items::text,'sha256'),'hex'),
      o.approved_at,now(),now()
    )
    returning id into v_dispatch_id;
  else
    update public.purchase_order_supplier_dispatches d
    set sent_at=coalesce(d.sent_at,now()),
        sent_by_account_id=coalesce(d.sent_by_account_id,a.id),
        sent_by_name=coalesce(d.sent_by_name,a.display_name),
        notes='Confirmed by branch-wide supplier response',
        snapshot_items=v_snapshot_items,
        snapshot_items_count=jsonb_array_length(v_snapshot_items),
        snapshot_quantity=v_snapshot_qty,
        snapshot_total=v_snapshot_total,
        snapshot_hash=encode(extensions.digest(v_snapshot_items::text,'sha256'),'hex'),
        snapshot_order_approved_at=coalesce(d.snapshot_order_approved_at,o.approved_at),
        updated_at=now()
    where d.id=v_dispatch_id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'id',v_snapshot_id,
      'order_id',v_order_id,
      'supplier_name',v_supplier,
      'idempotent',false,
      'allocations',coalesce((
        select jsonb_agg(to_jsonb(x) order by i.product_name)
        from public.purchase_order_supplier_allocations x
        join public.smart_purchase_order_items i on i.id=x.order_item_id
        where x.order_id=v_order_id
          and lower(trim(x.supplier_name))=v_supplier_key
      ),'[]'::jsonb)
    )
  );
end
$$;

revoke all on function public.smart_purchase_save_supplier_response_v1(text,jsonb) from public;
grant execute on function public.smart_purchase_save_supplier_response_v1(text,jsonb) to anon,authenticated;

create or replace function public.smart_purchase_receiving_read_v3(
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
  o public.smart_purchase_orders%rowtype;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if p_action='list_orders' then
    return public.smart_purchase_receiving_read_v2(p_session_token,p_action,p_payload);
  elsif p_action='get_order' then
    v_order_id:=nullif(p_payload->>'id','')::uuid;
    select * into o from public.smart_purchase_orders where id=v_order_id;
    if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
    if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;

    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'order',to_jsonb(o),
      'items',coalesce((
        select jsonb_agg(to_jsonb(i) order by i.supplier_name nulls last,i.product_name)
        from public.smart_purchase_order_items i
        where i.order_id=v_order_id
      ),'[]'::jsonb),
      'receipts',coalesce((
        select jsonb_agg(
          to_jsonb(r) || jsonb_build_object(
            'bonus_quantity',coalesce((
              select sum(coalesce(ri.bonus_quantity,0))
              from public.purchase_order_receipt_items ri
              where ri.receipt_id=r.id
            ),0),
            'items_count',coalesce((
              select count(*)
              from public.purchase_order_receipt_items ri
              where ri.receipt_id=r.id
            ),0)
          )
          order by r.created_at desc
        )
        from public.purchase_order_receipts r
        where r.order_id=v_order_id
      ),'[]'::jsonb),
      'supplier_responses',coalesce((
        select jsonb_agg(
          to_jsonb(latest_response)
          order by latest_response.first_created_at asc,latest_response.created_at asc
        )
        from (
          select distinct on (lower(trim(ws.supplier_name)))
            ws.id,ws.response_type,ws.supplier_name,ws.file_name,ws.summary,ws.details,ws.created_at,
            min(ws.created_at) over (
              partition by lower(trim(ws.supplier_name))
            ) as first_created_at
          from public.smart_purchase_workflow_snapshots ws
          where ws.order_id=v_order_id
            and ws.workflow_type='supplier_response'
            and coalesce(ws.summary->>'scope','')='branch_remaining_v1'
            and nullif(trim(ws.supplier_name),'') is not null
          order by lower(trim(ws.supplier_name)),ws.created_at desc,ws.id desc
        ) latest_response
      ),'[]'::jsonb),
      'supplier_allocations',coalesce((
        select jsonb_agg(to_jsonb(x) order by x.supplier_name,i.product_name)
        from public.purchase_order_supplier_allocations x
        join public.smart_purchase_order_items i on i.id=x.order_item_id
        where x.order_id=v_order_id
          and x.allocated_quantity>0
      ),'[]'::jsonb)
    ));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end
$$;

revoke all on function public.smart_purchase_receiving_read_v3(text,text,jsonb) from public;
grant execute on function public.smart_purchase_receiving_read_v3(text,text,jsonb) to anon,authenticated;

create or replace function public.smart_purchase_import_receipt_v5(
  p_session_token text,
  p_payload jsonb
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
  al public.purchase_order_supplier_allocations%rowtype;
  v_order_id uuid;
  v_supplier text;
  v_supplier_key text;
  v_file text;
  v_invoice_number text;
  v_receipt_date date;
  v_has_allocations boolean:=false;
  v_invalid_rows integer:=0;
  v_over_rows integer:=0;
  v_actual numeric:=0;
  v_expected numeric:=0;
  v_tolerance numeric:=0;
  v_effective_limit numeric:=0;
  v_receipt_id uuid;
  v_line_ordered numeric:=0;
  v_row_received numeric:=0;
  v_row_invoiced numeric:=0;
  v_row_unit_cost numeric:=0;
  v_row_actual_total numeric:=0;
  v_match text;
  rowj jsonb;
  v_receipt_expected numeric:=0;
  v_receipt_received numeric:=0;
  v_receipt_invoiced numeric:=0;
  v_receipt_qty_var numeric:=0;
  v_receipt_value_var numeric:=0;
  v_receipt_price_var numeric:=0;
  v_total_ordered numeric:=0;
  v_total_received numeric:=0;
  v_allocated_total numeric:=0;
  v_allocated_received numeric:=0;
  v_allocated_remaining numeric:=0;
  v_completion numeric:=0;
  v_supplier_status text:='open';
begin
  v_order_id:=nullif(p_payload->>'order_id','')::uuid;

  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  select * into o
  from public.smart_purchase_orders
  where id=v_order_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  select exists(
    select 1
    from public.purchase_order_supplier_allocations x
    where x.order_id=v_order_id and x.allocated_quantity>0
  ) into v_has_allocations;

  if not v_has_allocations then
    return public.smart_purchase_import_receipt_v4(p_session_token,p_payload);
  end if;

  v_supplier:=nullif(trim(p_payload->>'supplier_name'),'');
  v_supplier_key:=lower(trim(coalesce(v_supplier,'')));
  v_file:=nullif(trim(p_payload->>'file_name'),'');
  v_invoice_number:=nullif(trim(p_payload->>'supplier_invoice_number'),'');
  v_receipt_date:=coalesce(nullif(p_payload->>'receipt_date','')::date,current_date);

  if v_supplier is null then return jsonb_build_object('ok',false,'error','supplier_required'); end if;
  if jsonb_typeof(coalesce(p_payload->'rows','[]'::jsonb))<>'array' then
    return jsonb_build_object('ok',false,'error','invalid_rows');
  end if;
  if coalesce(o.status,'') not in ('معتمدة','تم الإرسال للمورد','approved','sent','partially_received','وصلت جزئيًا','received','وصلت بالكامل') then
    return jsonb_build_object('ok',false,'error','receipt_order_not_ready','status',o.status);
  end if;

  if not exists(
    select 1
    from public.purchase_order_supplier_allocations x
    where x.order_id=v_order_id
      and lower(trim(x.supplier_name))=v_supplier_key
      and x.allocated_quantity>x.received_quantity
  ) then
    return jsonb_build_object('ok',false,'error','supplier_has_no_allocation');
  end if;

  if not exists(
    select 1
    from public.purchase_order_supplier_dispatches d
    where d.order_id=v_order_id
      and d.sent_at is not null
      and lower(trim(d.supplier_name))=v_supplier_key
  ) then
    return jsonb_build_object('ok',false,'error','supplier_not_dispatched');
  end if;

  perform pg_advisory_xact_lock(hashtext(v_order_id::text||':allocated-receipt:'||coalesce(v_invoice_number,v_file,'manual')||':'||v_supplier_key));

  if v_invoice_number is not null and exists(
    select 1 from public.purchase_order_receipts r
    where r.order_id=v_order_id
      and lower(trim(coalesce(r.supplier_name,'')))=v_supplier_key
      and lower(trim(coalesce(r.supplier_invoice_number,'')))=lower(trim(v_invoice_number))
  ) then return jsonb_build_object('ok',false,'error','duplicate_supplier_invoice'); end if;

  if v_file is not null and exists(
    select 1 from public.purchase_order_receipts r
    where r.order_id=v_order_id
      and coalesce(r.source_file_name,'')=v_file
      and lower(trim(coalesce(r.supplier_name,'')))=v_supplier_key
  ) then return jsonb_build_object('ok',false,'error','duplicate_receipt_file'); end if;

  with input_rows as (
    select
      x as rowj,
      greatest(0,coalesce(nullif(x->>'received_quantity','')::numeric,0)) as received_quantity
    from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) x
    where greatest(0,coalesce(nullif(x->>'received_quantity','')::numeric,0))>0
  ),
  matched as (
    select ir.*,
      m.allocation_id,
      m.order_item_id,
      m.remaining_quantity
    from input_rows ir
    left join lateral (
      select
        x.id allocation_id,
        i.id order_item_id,
        greatest(0,x.allocated_quantity-x.received_quantity) remaining_quantity
      from public.purchase_order_supplier_allocations x
      join public.smart_purchase_order_items i on i.id=x.order_item_id
      where x.order_id=v_order_id
        and lower(trim(x.supplier_name))=v_supplier_key
        and (
          (nullif(trim(ir.rowj->>'product_code'),'') is not null
            and lower(trim(coalesce(i.product_code,'')))=lower(trim(ir.rowj->>'product_code')))
          or lower(trim(i.product_name))=lower(trim(coalesce(ir.rowj->>'product_name','')))
        )
      order by
        case when nullif(trim(ir.rowj->>'product_code'),'') is not null
          and lower(trim(coalesce(i.product_code,'')))=lower(trim(ir.rowj->>'product_code'))
          then 0 else 1 end,
        x.created_at
      limit 1
    ) m on true
  )
  select count(*) filter(where allocation_id is null)
  into v_invalid_rows
  from matched;

  if v_invalid_rows>0 then
    return jsonb_build_object('ok',false,'error','receipt_rows_not_allocated','invalid_rows',v_invalid_rows);
  end if;

  with input_rows as (
    select
      x as rowj,
      greatest(0,coalesce(nullif(x->>'received_quantity','')::numeric,0)) as received_quantity
    from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) x
    where greatest(0,coalesce(nullif(x->>'received_quantity','')::numeric,0))>0
  ),
  matched as (
    select ir.*,
      m.allocation_id,
      m.remaining_quantity
    from input_rows ir
    join lateral (
      select
        x.id allocation_id,
        greatest(0,x.allocated_quantity-x.received_quantity) remaining_quantity
      from public.purchase_order_supplier_allocations x
      join public.smart_purchase_order_items i on i.id=x.order_item_id
      where x.order_id=v_order_id
        and lower(trim(x.supplier_name))=v_supplier_key
        and (
          (nullif(trim(ir.rowj->>'product_code'),'') is not null
            and lower(trim(coalesce(i.product_code,'')))=lower(trim(ir.rowj->>'product_code')))
          or lower(trim(i.product_name))=lower(trim(coalesce(ir.rowj->>'product_name','')))
        )
      order by
        case when nullif(trim(ir.rowj->>'product_code'),'') is not null
          and lower(trim(coalesce(i.product_code,'')))=lower(trim(ir.rowj->>'product_code'))
          then 0 else 1 end,
        x.created_at
      limit 1
    ) m on true
  )
  select count(*)
  into v_over_rows
  from (
    select allocation_id
    from matched
    group by allocation_id
    having sum(received_quantity)>max(remaining_quantity)+0.0001
  ) q;

  if v_over_rows>0 then
    return jsonb_build_object('ok',false,'error','receipt_quantity_above_allocation','invalid_rows',v_over_rows);
  end if;

  select coalesce(sum(
    greatest(0,coalesce(nullif(x->>'actual_total','')::numeric,
      coalesce(nullif(x->>'invoiced_quantity','')::numeric,nullif(x->>'received_quantity','')::numeric,0)
      * coalesce(nullif(x->>'actual_unit_cost','')::numeric,0)
    ))
  ),0)
  into v_actual
  from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) x;

  select coalesce(sum(
    greatest(0,x.allocated_quantity-x.received_quantity)
    * greatest(0,coalesce(i.expected_unit_cost,0))
  ),0)
  into v_expected
  from public.purchase_order_supplier_allocations x
  join public.smart_purchase_order_items i on i.id=x.order_item_id
  where x.order_id=v_order_id
    and lower(trim(x.supplier_name))=v_supplier_key;

  v_tolerance:=greatest(100,v_expected*0.02);
  v_effective_limit:=v_expected+v_tolerance;

  if v_expected>0 and v_actual>v_effective_limit+0.01 then
    return jsonb_build_object(
      'ok',false,'error','receipt_value_above_supplier_limit',
      'actual_total',v_actual,
      'supplier_remaining_expected_total',v_expected,
      'effective_limit',v_effective_limit
    );
  end if;

  insert into public.purchase_order_receipts(
    order_id,supplier_name,supplier_invoice_number,receipt_date,source_file_name,
    created_by_account_id,created_by_name
  )
  values(
    v_order_id,v_supplier,v_invoice_number,v_receipt_date,v_file,a.id,a.display_name
  )
  returning id into v_receipt_id;

  for rowj in
    select value
    from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb))
  loop
    v_row_received:=greatest(0,coalesce(nullif(rowj->>'received_quantity','')::numeric,0));
    if v_row_received<=0 then
      continue;
    end if;

    select x.*
    into al
    from public.purchase_order_supplier_allocations x
    join public.smart_purchase_order_items oi on oi.id=x.order_item_id
    where x.order_id=v_order_id
      and lower(trim(x.supplier_name))=v_supplier_key
      and (
        (nullif(trim(rowj->>'product_code'),'') is not null
          and lower(trim(coalesce(oi.product_code,'')))=lower(trim(rowj->>'product_code')))
        or lower(trim(oi.product_name))=lower(trim(coalesce(rowj->>'product_name','')))
      )
    order by
      case when nullif(trim(rowj->>'product_code'),'') is not null
        and lower(trim(coalesce(oi.product_code,'')))=lower(trim(rowj->>'product_code'))
        then 0 else 1 end,
      x.created_at
    limit 1
    for update of x;

    select *
    into i
    from public.smart_purchase_order_items
    where id=al.order_item_id and order_id=v_order_id
    for update;

    v_line_ordered:=greatest(0,al.allocated_quantity-al.received_quantity);
    v_row_invoiced:=greatest(0,coalesce(nullif(rowj->>'invoiced_quantity','')::numeric,v_row_received));
    v_row_unit_cost:=greatest(0,coalesce(nullif(rowj->>'actual_unit_cost','')::numeric,0));
    v_row_actual_total:=greatest(0,coalesce(
      nullif(rowj->>'actual_total','')::numeric,
      v_row_invoiced*v_row_unit_cost
    ));

    v_match:=case
      when v_row_received<=0 then 'لم يصل'
      when v_row_received<v_line_ordered then 'ناقص'
      when v_row_received>v_line_ordered then 'زائد'
      when abs(v_row_unit_cost-coalesce(i.expected_unit_cost,0))>greatest(0.01,coalesce(i.expected_unit_cost,0)*0.03) then 'فرق سعر'
      when v_row_invoiced<>v_row_received then 'فرق فاتورة'
      else 'سليم'
    end;

    insert into public.purchase_order_receipt_items(
      receipt_id,order_item_id,product_code,product_name,
      ordered_quantity,received_quantity,invoiced_quantity,bonus_quantity,
      expected_unit_cost,actual_unit_cost,expected_discount,actual_discount,
      expected_total,actual_total,quantity_variance,invoice_quantity_variance,
      price_variance,value_variance,effective_unit_cost,match_status,notes,source_row
    )
    values(
      v_receipt_id,i.id,coalesce(nullif(rowj->>'product_code',''),i.product_code),
      coalesce(nullif(rowj->>'product_name',''),i.product_name),
      v_line_ordered,v_row_received,v_row_invoiced,
      greatest(0,coalesce(nullif(rowj->>'bonus_quantity','')::numeric,0)),
      coalesce(i.expected_unit_cost,0),v_row_unit_cost,
      coalesce(i.expected_discount,0),greatest(0,coalesce(nullif(rowj->>'actual_discount','')::numeric,0)),
      v_line_ordered*coalesce(i.expected_unit_cost,0),v_row_actual_total,
      v_row_received-v_line_ordered,v_row_invoiced-v_row_received,
      v_row_unit_cost-coalesce(i.expected_unit_cost,0),
      v_row_actual_total-(v_line_ordered*coalesce(i.expected_unit_cost,0)),
      case when v_row_received+greatest(0,coalesce(nullif(rowj->>'bonus_quantity','')::numeric,0))>0
        then v_row_actual_total/(v_row_received+greatest(0,coalesce(nullif(rowj->>'bonus_quantity','')::numeric,0)))
        else 0 end,
      v_match,rowj->>'notes',rowj
    );

    update public.smart_purchase_order_items
    set received_quantity=coalesce(received_quantity,0)+v_row_received,
        invoiced_quantity=coalesce(invoiced_quantity,0)+v_row_invoiced,
        actual_unit_cost=case when v_row_unit_cost>0 then v_row_unit_cost else actual_unit_cost end,
        actual_discount=greatest(0,coalesce(nullif(rowj->>'actual_discount','')::numeric,actual_discount)),
        actual_total=coalesce(actual_total,0)+v_row_actual_total,
        status=v_match,
        updated_at=now()
    where id=i.id;

    update public.purchase_order_supplier_allocations
    set received_quantity=coalesce(received_quantity,0)+v_row_received,
        updated_at=now()
    where id=al.id;
  end loop;

  select
    coalesce(sum(ri.expected_total),0),
    coalesce(sum(ri.received_quantity*ri.actual_unit_cost),0),
    coalesce(sum(ri.actual_total),0),
    coalesce(sum(ri.quantity_variance),0),
    coalesce(sum(ri.value_variance),0),
    coalesce(sum(ri.price_variance),0),
    coalesce(sum(ri.ordered_quantity) filter(where ri.order_item_id is not null),0),
    coalesce(sum(ri.received_quantity) filter(where ri.order_item_id is not null),0)
  into
    v_receipt_expected,v_receipt_received,v_receipt_invoiced,
    v_receipt_qty_var,v_receipt_value_var,v_receipt_price_var,
    v_total_ordered,v_total_received
  from public.purchase_order_receipt_items ri
  where ri.receipt_id=v_receipt_id;

  select
    coalesce(sum(x.allocated_quantity),0),
    coalesce(sum(least(x.allocated_quantity,x.received_quantity)),0)
  into v_allocated_total,v_allocated_received
  from public.purchase_order_supplier_allocations x
  where x.order_id=v_order_id
    and lower(trim(x.supplier_name))=v_supplier_key;

  v_allocated_remaining:=greatest(0,v_allocated_total-v_allocated_received);
  v_completion:=case when v_allocated_total>0 then round(100*v_allocated_received/v_allocated_total,2) else 0 end;
  v_supplier_status:=case
    when v_allocated_total<=0 then 'needs_review'
    when v_allocated_remaining<=0 then 'completed'
    when v_allocated_received>0 then 'partial'
    else 'not_received'
  end;

  update public.purchase_order_receipts
  set status=case
        when v_total_ordered=0 then 'needs_review'
        when v_total_received>=v_total_ordered then 'completed'
        when v_total_received>0 then 'partial'
        else 'not_received'
      end,
      expected_total=v_receipt_expected,
      received_total=v_receipt_received,
      invoiced_total=v_receipt_invoiced,
      quantity_variance=v_receipt_qty_var,
      value_variance=v_receipt_value_var,
      price_variance=v_receipt_price_var,
      completion_rate=case when v_total_ordered>0 then round(100*v_total_received/v_total_ordered,2) else 0 end,
      price_score=greatest(0,least(100,100-case when v_receipt_expected>0 then abs(v_receipt_value_var)/v_receipt_expected*100 else 0 end)),
      supplier_score=greatest(0,least(100,
        (case when v_total_ordered>0 then 70*v_total_received/v_total_ordered else 0 end)
        +(case when v_receipt_expected>0 then greatest(0,30-abs(v_receipt_value_var)/v_receipt_expected*30) else 30 end)
      )),
      cumulative_ordered_quantity=v_allocated_total,
      cumulative_received_quantity=v_allocated_received,
      cumulative_remaining_quantity=v_allocated_remaining,
      cumulative_completion_rate=v_completion,
      supplier_order_status=v_supplier_status,
      updated_at=now()
  where id=v_receipt_id;

  update public.smart_purchase_order_items oi
  set status=case
      when coalesce(oi.received_quantity,0)<=0 then 'لم يصل'
      when coalesce(oi.received_quantity,0)<coalesce(oi.approved_quantity,oi.requested_quantity,0) then 'ناقص'
      when coalesce(oi.received_quantity,0)>coalesce(oi.approved_quantity,oi.requested_quantity,0) then 'زائد'
      when coalesce(oi.actual_unit_cost,0)>0 and coalesce(oi.expected_unit_cost,0)>0
        and abs(oi.actual_unit_cost-oi.expected_unit_cost)>greatest(0.01,oi.expected_unit_cost*0.03) then 'فرق سعر'
      when coalesce(oi.invoiced_quantity,0)<>coalesce(oi.received_quantity,0) then 'فرق فاتورة'
      else 'سليم'
    end,
    updated_at=now()
  where oi.order_id=v_order_id;

  update public.smart_purchase_orders ord
  set received_total=(
        select coalesce(sum(oi.actual_total),0)
        from public.smart_purchase_order_items oi
        where oi.order_id=ord.id
      ),
      status=case
        when (select coalesce(sum(oi.received_quantity),0) from public.smart_purchase_order_items oi where oi.order_id=ord.id)
             >=
             (select coalesce(sum(oi.approved_quantity),0) from public.smart_purchase_order_items oi where oi.order_id=ord.id)
        then 'received'
        when (select coalesce(sum(oi.received_quantity),0) from public.smart_purchase_order_items oi where oi.order_id=ord.id)>0
        then 'partially_received'
        else ord.status
      end,
      updated_at=now()
  where ord.id=v_order_id;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'receipt_id',v_receipt_id,
      'status',v_supplier_status,
      'allocation_mode',true,
      'cumulative',jsonb_build_object(
        'supplier_name',v_supplier,
        'ordered_quantity',v_allocated_total,
        'received_quantity',v_allocated_received,
        'remaining_quantity',v_allocated_remaining,
        'completion_rate',v_completion,
        'status',v_supplier_status
      )
    )
  );
end
$$;

revoke all on function public.smart_purchase_import_receipt_v5(text,jsonb) from public;
grant execute on function public.smart_purchase_import_receipt_v5(text,jsonb) to anon,authenticated;

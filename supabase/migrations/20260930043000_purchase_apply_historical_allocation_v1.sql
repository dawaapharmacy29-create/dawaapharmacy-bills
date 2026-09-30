-- Apply the reviewed historical supplier + historical effective cost to draft orders.
-- This does NOT approve, dispatch, or receive an order. It only turns the read-only
-- historical recommendation into the persisted draft values after an explicit user action.

create or replace function public.smart_purchase_apply_historical_allocation_v1(
  p_session_token text,
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  a record;
  v_order_id uuid;
  v_order public.smart_purchase_orders%rowtype;
  v_item_count int;
  v_mappable_count int;
  v_total numeric;
  v_results jsonb := '[]'::jsonb;
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

  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if coalesce(cardinality(p_order_ids),0) < 1 then
    return jsonb_build_object('ok',false,'error','order_not_found');
  end if;

  foreach v_order_id in array p_order_ids loop
    select * into v_order
    from public.smart_purchase_orders
    where id=v_order_id
    for update;

    if not found then
      raise exception 'order_not_found:%', v_order_id;
    end if;

    if not public.smart_purchase_branch_allowed_v2(a.id,v_order.branch) then
      raise exception 'forbidden_branch:%', v_order.branch;
    end if;

    if coalesce(v_order.status,'مسودة') not in ('draft','مسودة') then
      raise exception 'historical_allocation_requires_draft:%', v_order.order_number;
    end if;

    if v_order.sent_at is not null
       or exists (
         select 1 from public.purchase_order_supplier_dispatches d
         where d.order_id=v_order.id and d.sent_at is not null
       )
       or exists (
         select 1 from public.purchase_order_receipts r
         where r.order_id=v_order.id
       )
    then
      raise exception 'order_execution_started:%', v_order.order_number;
    end if;

    select count(*) into v_item_count
    from public.smart_purchase_order_items i
    where i.order_id=v_order.id
      and coalesce(i.approved_quantity,0)>0;

    with picked as (
      select i.id as item_id,
             h.supplier_name,
             coalesce(nullif(h.avg_effective_unit_cost,0),nullif(h.last_unit_cost,0),0) as hist_cost,
             h.purchase_events,
             h.last_purchase_date
      from public.smart_purchase_order_items i
      left join lateral (
        select h.*
        from public.purchase_supplier_history_profiles h
        where h.branch=v_order.branch
          and h.product_key=coalesce(
            nullif(trim(i.product_code),''),
            public.purchase_normalize_product_name(i.product_name)
          )
          and nullif(trim(h.supplier_name),'') is not null
          and lower(trim(h.supplier_name)) not like 'دواء %'
          and lower(trim(h.supplier_name)) not like '%جرد%'
          and lower(trim(h.supplier_name)) <> 'شحن خارجي'
          and lower(trim(h.supplier_name)) <> 'صيدليات'
          and lower(trim(h.supplier_name)) <> 'مورد متنوع'
        order by
          case
            when h.purchase_events>=2 and h.last_purchase_date >= (current_date - interval '90 days')::date then 0
            when h.purchase_events=1 and h.last_purchase_date >= (current_date - interval '90 days')::date then 1
            when h.purchase_events>=2 then 2
            else 3
          end,
          h.avg_effective_unit_cost asc nulls last,
          h.purchase_events desc,
          h.last_purchase_date desc nulls last
        limit 1
      ) h on true
      where i.order_id=v_order.id
        and coalesce(i.approved_quantity,0)>0
    )
    select count(*) into v_mappable_count
    from picked
    where nullif(trim(supplier_name),'') is not null
      and hist_cost>0;

    if v_item_count=0 or v_mappable_count<>v_item_count then
      raise exception 'historical_allocation_incomplete:%/%:%',
        v_mappable_count,v_item_count,v_order.order_number;
    end if;

    with picked as (
      select i.id as item_id,
             h.supplier_name,
             coalesce(nullif(h.avg_effective_unit_cost,0),nullif(h.last_unit_cost,0),0) as hist_cost,
             h.purchase_events,
             h.last_purchase_date,
             case
               when h.purchase_events>=2 and h.last_purchase_date >= (current_date - interval '90 days')::date then 'high'
               when (h.purchase_events=1 and h.last_purchase_date >= (current_date - interval '90 days')::date)
                    or h.purchase_events>=2 then 'medium'
               when h.purchase_events=1 then 'low'
               else 'missing'
             end as confidence
      from public.smart_purchase_order_items i
      join lateral (
        select h.*
        from public.purchase_supplier_history_profiles h
        where h.branch=v_order.branch
          and h.product_key=coalesce(
            nullif(trim(i.product_code),''),
            public.purchase_normalize_product_name(i.product_name)
          )
          and nullif(trim(h.supplier_name),'') is not null
          and lower(trim(h.supplier_name)) not like 'دواء %'
          and lower(trim(h.supplier_name)) not like '%جرد%'
          and lower(trim(h.supplier_name)) <> 'شحن خارجي'
          and lower(trim(h.supplier_name)) <> 'صيدليات'
          and lower(trim(h.supplier_name)) <> 'مورد متنوع'
        order by
          case
            when h.purchase_events>=2 and h.last_purchase_date >= (current_date - interval '90 days')::date then 0
            when h.purchase_events=1 and h.last_purchase_date >= (current_date - interval '90 days')::date then 1
            when h.purchase_events>=2 then 2
            else 3
          end,
          h.avg_effective_unit_cost asc nulls last,
          h.purchase_events desc,
          h.last_purchase_date desc nulls last
        limit 1
      ) h on true
      where i.order_id=v_order.id
        and coalesce(i.approved_quantity,0)>0
    )
    update public.smart_purchase_order_items i
    set supplier_name=p.supplier_name,
        expected_unit_cost=round(p.hist_cost::numeric,4),
        expected_total=round((coalesce(i.approved_quantity,0)*p.hist_cost)::numeric,2),
        supplier_offer_id=null,
        supplier_reason='historical_purchase_v1:'||p.confidence,
        cost_source='reference',
        cost_verified_at=null,
        cost_verified_by_account_id=null,
        cost_verified_by_name=null,
        updated_at=now()
    from picked p
    where i.id=p.item_id;

    select round(coalesce(sum(expected_total),0)::numeric,2)
    into v_total
    from public.smart_purchase_order_items
    where order_id=v_order.id
      and coalesce(approved_quantity,0)>0;

    update public.smart_purchase_orders
    set expected_total=v_total,
        approved_total=v_total,
        updated_at=now()
    where id=v_order.id;

    insert into public.purchase_status_history(
      source_type,record_id,old_status,new_status,reason,
      changed_by_account_id,changed_by_name,changed_at
    )
    values(
      'smart_purchase_order',
      v_order.id::text,
      v_order.status,
      v_order.status,
      'Applied reviewed historical supplier/cost allocation without approval or dispatch',
      a.id,
      a.display_name,
      now()
    );

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'order_id',v_order.id,
        'order_number',v_order.order_number,
        'branch',v_order.branch,
        'items',v_item_count,
        'total',v_total
      )
    );
  end loop;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'orders',v_results,
      'orders_count',jsonb_array_length(v_results),
      'items_count',(
        select count(*)
        from public.smart_purchase_order_items
        where order_id=any(p_order_ids)
          and coalesce(approved_quantity,0)>0
      ),
      'grand_total',(
        select round(coalesce(sum(approved_total),0)::numeric,2)
        from public.smart_purchase_orders
        where id=any(p_order_ids)
      )
    )
  );
end
$function$;

revoke all on function public.smart_purchase_apply_historical_allocation_v1(text,uuid[]) from public;
grant execute on function public.smart_purchase_apply_historical_allocation_v1(text,uuid[]) to anon,authenticated;

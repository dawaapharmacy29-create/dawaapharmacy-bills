-- Allow a new planning cycle only after every UNALLOCATED sourcing gap
-- in an older order has been explicitly handed to the persistent shortage registry.
-- Quantities already allocated to suppliers remain pending incoming and are not treated
-- as an uncovered sourcing gap.

create or replace function public.smart_purchase_order_shortage_handoff_complete_v1(
  p_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path='pg_catalog','public'
as $$
  select
    exists(
      select 1
      from public.purchase_shortage_events e
      where e.order_id=p_order_id
    )
    and not exists(
      select 1
      from public.smart_purchase_order_items i
      where i.order_id=p_order_id
        and greatest(
          0,
          coalesce(i.approved_quantity,i.requested_quantity,0)
          - coalesce((
              select sum(greatest(0,a.allocated_quantity))
              from public.purchase_order_supplier_allocations a
              where a.order_item_id=i.id
            ),0)
        ) > 0
        and not exists(
          select 1
          from public.purchase_shortage_events e
          where e.order_item_id=i.id
        )
    )
$$;

revoke all on function public.smart_purchase_order_shortage_handoff_complete_v1(uuid)
  from public,anon,authenticated;

create or replace function public.smart_purchase_branch_has_blocking_order_clean_v1(
  p_branch text
)
returns boolean
language sql
stable
security definer
set search_path='pg_catalog','public'
as $$
  select exists(
    select 1
    from public.smart_purchase_orders o
    where o.branch=p_branch
      and not public.smart_purchase_order_shortage_handoff_complete_v1(o.id)
      and coalesce(o.status,'') not in (
        'ملغاة','cancelled','canceled',
        'مغلقة','closed',
        'وصلت بالكامل','received',
        'تمت مطابقة الفاتورة','matched'
      )
      and (
        (
          o.created_at >= now()-interval '30 days'
          and o.status in (
            'draft','مسودة','تم التحليل','معتمدة','approved',
            'تم الإرسال للمورد','sent',
            'وصلت جزئيًا','partially_received'
          )
        )
        or (
          exists(
            select 1
            from public.purchase_order_supplier_dispatches d
            where d.order_id=o.id and d.sent_at is not null
          )
          and exists(
            select 1
            from public.smart_purchase_order_items i
            where i.order_id=o.id
              and greatest(0,coalesce(i.approved_quantity,0)-coalesce(i.received_quantity,0))>0
          )
        )
        or (
          exists(
            select 1
            from public.purchase_order_receipts r
            where r.order_id=o.id
              and coalesce(r.cumulative_remaining_quantity,0)>0
          )
        )
      )
  )
$$;

revoke all on function public.smart_purchase_branch_has_blocking_order_clean_v1(text)
  from public,anon,authenticated;

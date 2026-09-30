-- Planning-order guard: sent/receiving orders no longer block a new planning cycle.
create or replace function public.smart_purchase_branch_has_planning_order_v2(
  p_branch text
) returns boolean
language sql stable security definer
set search_path='pg_catalog','public'
as $$
  select exists(
    select 1
    from public.smart_purchase_orders o
    where o.branch=p_branch
      and o.status in ('draft','مسودة','تم التحليل','معتمدة','approved')
  )
$$;

revoke all on function public.smart_purchase_branch_has_planning_order_v2(text) from public;

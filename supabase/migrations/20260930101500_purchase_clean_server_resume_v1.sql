-- Server-side resume for the clean purchase journey.
-- Returns the current user's latest still-open clean journey within 12 hours.
-- Supports draft review and approved/supplier-dispatch stages, but stops once receiving starts.
create or replace function public.smart_purchase_resume_clean_journey_v1(
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  a record;
  r record;
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

  select
    d.plan_hash,
    d.stock_sync_id,
    d.shokry_order_id,
    d.shamy_order_id,
    d.created_at,
    os.order_number shokry_order_number,
    om.order_number shamy_order_number,
    os.status shokry_status,
    om.status shamy_status
  into r
  from public.smart_purchase_dual_plan_runs d
  join public.smart_purchase_orders os on os.id=d.shokry_order_id
  join public.smart_purchase_orders om on om.id=d.shamy_order_id
  where d.created_by_account_id=a.id
    and d.created_at>=now()-interval '12 hours'
    and (
      (
        coalesce(os.status,'') in ('draft','مسودة')
        and coalesce(om.status,'') in ('draft','مسودة')
      )
      or (
        coalesce(os.status,'') in ('معتمدة','approved','تم الإرسال للمورد','sent')
        and coalesce(om.status,'') in ('معتمدة','approved','تم الإرسال للمورد','sent')
      )
    )
    and not exists (
      select 1
      from public.purchase_order_receipts x
      where x.order_id in (d.shokry_order_id,d.shamy_order_id)
    )
  order by d.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok',true,'data',jsonb_build_object('found',false));
  end if;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'found',true,
    'plan_hash',r.plan_hash,
    'stock_sync_id',r.stock_sync_id,
    'shokry_order_id',r.shokry_order_id,
    'shamy_order_id',r.shamy_order_id,
    'shokry_order_number',r.shokry_order_number,
    'shamy_order_number',r.shamy_order_number,
    'shokry_status',r.shokry_status,
    'shamy_status',r.shamy_status,
    'stage',case
      when r.shokry_status in ('draft','مسودة')
       and r.shamy_status in ('draft','مسودة') then 'draft'
      else 'dispatch'
    end,
    'created_at',r.created_at
  ));
end
$function$;

revoke all on function public.smart_purchase_resume_clean_journey_v1(text) from public;
grant execute on function public.smart_purchase_resume_clean_journey_v1(text) to anon,authenticated;

-- Read-only B-Connect batch lookup. This migration is intentionally NOT a workflow mutation.
create or replace function public.app_bconnect_invoice_number_check(
  p_session_token text,
  p_numbers text[]
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_rows jsonb;
begin
  select a.* into v_account
  from public.staff_sessions s join public.staff_accounts a on a.id=s.account_id
  where s.token_hash=encode(digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>now() and a.status='active'
  order by s.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  with wanted as (
    select distinct trim(x) number from unnest(coalesce(p_numbers,array[]::text[])) x where trim(x)<>''
  ), global_counts as (
    select trim(p.system_invoice_number) number,count(*)::int record_count
    from public.purchase_invoices p join wanted w on w.number=trim(coalesce(p.system_invoice_number,''))
    where coalesce(p.is_sample,false)=false and coalesce(p.base44_sync_state,'active')='active'
    group by trim(p.system_invoice_number)
  ), visible as (
    select p.id,trim(p.system_invoice_number) system_invoice_number,p.branch,p.supplier_name,p.invoice_date,
           p.total_value,p.workflow_status,p.status,p.created_at,p.updated_at
    from public.purchase_invoices p join wanted w on w.number=trim(coalesce(p.system_invoice_number,''))
    where coalesce(p.is_sample,false)=false and coalesce(p.base44_sync_state,'active')='active'
      and (v_account.role='general_manager' or coalesce(v_account.branch_ids,'[]'::jsonb) ? p.branch)
  ), packed as (
    select w.number,coalesce(g.record_count,0) record_count,
      coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from visible v where v.system_invoice_number=w.number),'[]'::jsonb) rows
    from wanted w left join global_counts g on g.number=w.number
  )
  select coalesce(jsonb_agg(to_jsonb(packed) order by number),'[]'::jsonb) into v_rows from packed;

  return jsonb_build_object('ok',true,'data',v_rows,'scope','global_count_authorized_details');
end; $$;

revoke all on function public.app_bconnect_invoice_number_check(text,text[]) from public;
grant execute on function public.app_bconnect_invoice_number_check(text,text[]) to anon,authenticated,service_role;

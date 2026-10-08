-- Read-only B-Connect global invoice-number evidence. No invoice mutation.
create or replace function public.app_bconnect_invoice_number_check(
  p_session_token text,
  p_numbers text[]
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_rows jsonb;
begin
  select a.* into v_account
  from public.staff_sessions s
  join public.staff_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and s.revoked_at is null and s.expires_at > now() and a.status = 'active'
  order by s.created_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  if coalesce(array_length(p_numbers, 1), 0) > 500 then
    return jsonb_build_object('ok', false, 'error', 'too_many_invoice_numbers');
  end if;

  with wanted as (
    select distinct case
      when trim(x) ~ '^[0-9]+[.]0+$' then split_part(trim(x), '.', 1)
      else trim(x)
    end as number
    from unnest(coalesce(p_numbers, array[]::text[])) as x
    where trim(x) <> ''
  ), matched as (
    select p.*,
      case when trim(p.system_invoice_number) ~ '^[0-9]+[.]0+$'
        then split_part(trim(p.system_invoice_number), '.', 1)
        else trim(p.system_invoice_number)
      end as normalized_number
    from public.purchase_invoices p
    where coalesce(p.is_sample, false) = false
      and coalesce(p.base44_sync_state, 'active') = 'active'
  ), global_counts as (
    select m.normalized_number as number, count(*)::int as record_count
    from matched m join wanted w on w.number = m.normalized_number
    group by m.normalized_number
  ), visible as (
    select m.id, m.normalized_number as system_invoice_number,
      m.branch, m.supplier_name, m.invoice_date, m.total_value,
      m.workflow_status, m.status, m.created_at, m.updated_at
    from matched m join wanted w on w.number = m.normalized_number
    where v_account.role = 'general_manager'
      or coalesce(v_account.branch_ids, '[]'::jsonb) ? m.branch
  ), packed as (
    select w.number, coalesce(g.record_count, 0) as record_count,
      coalesce((
        select jsonb_agg(to_jsonb(v) order by v.created_at)
        from visible v where v.system_invoice_number = w.number
      ), '[]'::jsonb) as rows
    from wanted w left join global_counts g on g.number = w.number
  )
  select coalesce(jsonb_agg(to_jsonb(packed) order by number), '[]'::jsonb)
    into v_rows from packed;

  return jsonb_build_object('ok', true, 'data', v_rows, 'scope', 'global_count_authorized_details');
end;
$$;

revoke all on function public.app_bconnect_invoice_number_check(text, text[]) from public;
grant execute on function public.app_bconnect_invoice_number_check(text, text[]) to anon, authenticated, service_role;

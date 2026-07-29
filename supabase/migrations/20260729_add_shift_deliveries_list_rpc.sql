create or replace function public.app_shift_deliveries_list(
  p_session_token text,
  p_date_from date default null,
  p_date_to date default null,
  p_branch text default null,
  p_limit integer default 1000,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
  v_allowed_branches text[];
  v_rows jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  select a.role, coalesce(a.branch_ids, '{}'::text[])
    into v_role, v_allowed_branches
  from public.staff_sessions s
  join public.staff_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and a.status = 'active'
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  update public.staff_sessions
     set last_seen_at = now()
   where token_hash = encode(digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
     and revoked_at is null;

  if p_branch is not null and p_branch <> 'all'
     and v_role <> 'general_manager'
     and not (p_branch = any(v_allowed_branches)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.shift_date desc, x.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select sd.*
    from public.shift_deliveries sd
    where (p_date_from is null or sd.shift_date >= p_date_from)
      and (p_date_to is null or sd.shift_date <= p_date_to)
      and (p_branch is null or p_branch = 'all' or sd.branch = p_branch)
      and (
        v_role = 'general_manager'
        or coalesce(array_length(v_allowed_branches, 1), 0) = 0
        or sd.branch = any(v_allowed_branches)
      )
    order by sd.shift_date desc, sd.created_at desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object(
    'ok', true,
    'data', coalesce(v_rows, '[]'::jsonb),
    'count', jsonb_array_length(coalesce(v_rows, '[]'::jsonb))
  );
end;
$$;

revoke all on function public.app_shift_deliveries_list(text,date,date,text,integer,integer) from public;
grant execute on function public.app_shift_deliveries_list(text,date,date,text,integer,integer) to anon, authenticated;

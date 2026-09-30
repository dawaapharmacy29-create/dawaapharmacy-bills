-- Persistent branch defaults for purchase order minimum, maximum and coverage.
create table if not exists public.purchase_branch_policies (
  id uuid primary key default gen_random_uuid(),
  branch text not null unique,
  minimum_order_value numeric not null default 0 check(minimum_order_value>=0),
  maximum_order_value numeric not null default 0 check(maximum_order_value>=0),
  default_coverage_days numeric not null default 7 check(default_coverage_days>0),
  is_active boolean not null default true,
  notes text,
  updated_by_account_id uuid references public.staff_accounts(id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_branch_policies_min_max_chk check(
    minimum_order_value=0 or maximum_order_value=0 or minimum_order_value<=maximum_order_value
  )
);

alter table public.purchase_branch_policies enable row level security;
revoke all on table public.purchase_branch_policies from public,anon,authenticated;

create or replace function public.smart_purchase_branch_policy_v2(
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
  v_branch text;
  v_min numeric;
  v_max numeric;
  v_days numeric;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  v_branch:=nullif(trim(p_payload->>'branch'),'');
  if v_branch is null then return jsonb_build_object('ok',false,'error','branch_required'); end if;

  if p_action='get' then
    return jsonb_build_object('ok',true,'data',coalesce((
      select to_jsonb(p) from public.purchase_branch_policies p
      where p.branch=v_branch and p.is_active=true
    ),jsonb_build_object(
      'branch',v_branch,'minimum_order_value',0,'maximum_order_value',0,
      'default_coverage_days',7,'is_active',true
    )));

  elsif p_action='upsert' then
    if a.role not in ('general_manager','branch_manager','purchasing') then
      return jsonb_build_object('ok',false,'error','forbidden');
    end if;

    v_min:=greatest(0,coalesce(nullif(p_payload->>'minimum_order_value','')::numeric,0));
    v_max:=greatest(0,coalesce(nullif(p_payload->>'maximum_order_value','')::numeric,0));
    v_days:=greatest(1,coalesce(nullif(p_payload->>'default_coverage_days','')::numeric,7));
    if v_min>0 and v_max>0 and v_min>v_max then
      return jsonb_build_object('ok',false,'error','order_min_exceeds_max');
    end if;

    insert into public.purchase_branch_policies(
      branch,minimum_order_value,maximum_order_value,default_coverage_days,
      is_active,updated_by_account_id,updated_by_name,created_at,updated_at
    ) values (
      v_branch,v_min,v_max,v_days,true,a.id,a.display_name,now(),now()
    )
    on conflict(branch) do update set
      minimum_order_value=excluded.minimum_order_value,
      maximum_order_value=excluded.maximum_order_value,
      default_coverage_days=excluded.default_coverage_days,
      is_active=true,
      updated_by_account_id=a.id,
      updated_by_name=a.display_name,
      updated_at=now();

    return jsonb_build_object('ok',true,'data',(
      select to_jsonb(p) from public.purchase_branch_policies p where p.branch=v_branch
    ));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $$;

revoke all on function public.smart_purchase_branch_policy_v2(text,text,jsonb) from public;
grant execute on function public.smart_purchase_branch_policy_v2(text,text,jsonb) to anon,authenticated;

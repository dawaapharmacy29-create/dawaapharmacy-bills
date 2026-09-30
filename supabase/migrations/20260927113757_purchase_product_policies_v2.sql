-- Persistent branch-level purchasing policies for products.

create table if not exists public.purchase_product_policies (
  id uuid primary key default gen_random_uuid(),
  branch text not null,
  product_key text not null,
  product_code text,
  product_name text not null,
  minimum_order_quantity numeric not null default 0 check (minimum_order_quantity >= 0),
  maximum_order_quantity numeric not null default 0 check (maximum_order_quantity >= 0),
  target_coverage_days numeric not null default 0 check (target_coverage_days >= 0),
  package_multiple numeric not null default 0 check (package_multiple >= 0),
  is_active boolean not null default true,
  notes text,
  updated_by_account_id uuid references public.staff_accounts(id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_product_policies_min_max_chk check (
    minimum_order_quantity=0 or maximum_order_quantity=0 or minimum_order_quantity<=maximum_order_quantity
  ),
  constraint purchase_product_policies_branch_key_uidx unique (branch, product_key)
);

alter table public.purchase_product_policies enable row level security;

create index if not exists purchase_product_policies_branch_active_idx
  on public.purchase_product_policies(branch,is_active);

create or replace function public.smart_purchase_product_policies_v2(
  p_session_token text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  v_account record; v_branch text; v_item jsonb; v_key text; v_name text; v_code text;
  v_min numeric; v_max numeric; v_coverage numeric; v_multiple numeric; v_active boolean; v_count integer:=0;
begin
  select sa.* into v_account
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  if p_action='list' then
    v_branch:=nullif(trim(p_payload->>'branch'),'');
    if v_branch is null then return jsonb_build_object('ok',false,'error','branch_required'); end if;
    return jsonb_build_object('ok',true,'data',coalesce((
      select jsonb_agg(to_jsonb(p) order by p.product_name)
      from public.purchase_product_policies p
      where p.branch=v_branch and p.is_active=true
    ),'[]'::jsonb));
  end if;

  if p_action='upsert_many' then
    if v_account.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
    v_branch:=nullif(trim(p_payload->>'branch'),'');
    if v_branch is null then return jsonb_build_object('ok',false,'error','branch_required'); end if;
    if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))<>'array' then return jsonb_build_object('ok',false,'error','invalid_items'); end if;

    for v_item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
      v_key:=nullif(trim(v_item->>'product_key'),'');
      v_name:=nullif(trim(v_item->>'product_name'),'');
      v_code:=nullif(trim(v_item->>'product_code'),'');
      v_min:=greatest(0,floor(coalesce(nullif(v_item->>'minimum_order_quantity','')::numeric,0)));
      v_max:=greatest(0,floor(coalesce(nullif(v_item->>'maximum_order_quantity','')::numeric,0)));
      v_coverage:=greatest(0,coalesce(nullif(v_item->>'target_coverage_days','')::numeric,0));
      v_multiple:=greatest(0,floor(coalesce(nullif(v_item->>'package_multiple','')::numeric,0)));
      v_active:=coalesce((v_item->>'is_active')::boolean,true);

      if v_key is null or v_name is null then continue; end if;
      if v_min>0 and v_max>0 and v_min>v_max then return jsonb_build_object('ok',false,'error','item_min_exceeds_max','product_name',v_name); end if;

      insert into public.purchase_product_policies(
        branch,product_key,product_code,product_name,minimum_order_quantity,maximum_order_quantity,
        target_coverage_days,package_multiple,is_active,notes,updated_by_account_id,updated_by_name,created_at,updated_at
      ) values (
        v_branch,v_key,v_code,v_name,v_min,v_max,v_coverage,v_multiple,v_active,nullif(v_item->>'notes',''),
        v_account.id,v_account.display_name,now(),now()
      )
      on conflict (branch,product_key) do update set
        product_code=excluded.product_code,
        product_name=excluded.product_name,
        minimum_order_quantity=excluded.minimum_order_quantity,
        maximum_order_quantity=excluded.maximum_order_quantity,
        target_coverage_days=excluded.target_coverage_days,
        package_multiple=excluded.package_multiple,
        is_active=excluded.is_active,
        notes=excluded.notes,
        updated_by_account_id=v_account.id,
        updated_by_name=v_account.display_name,
        updated_at=now();
      v_count:=v_count+1;
    end loop;

    return jsonb_build_object('ok',true,'data',jsonb_build_object('updated',v_count));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $$;

revoke all on table public.purchase_product_policies from public,anon,authenticated;
revoke all on function public.smart_purchase_product_policies_v2(text,text,jsonb) from public;
grant execute on function public.smart_purchase_product_policies_v2(text,text,jsonb) to anon,authenticated;

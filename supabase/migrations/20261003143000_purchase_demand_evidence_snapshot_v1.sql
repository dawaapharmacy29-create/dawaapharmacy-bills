-- Canonical transaction-demand evidence contract.
-- Observed invoice behavior is stored separately from derived inventory policy.
-- No customer identifiers or invoice numbers are persisted here.

create table if not exists public.purchase_demand_evidence_snapshots (
  branch text not null check (branch in ('دواء شكري','دواء الشامي')),
  product_key text not null,
  product_code text not null,
  units_30d numeric not null default 0 check (units_30d >= 0),
  invoices_30d integer not null default 0 check (invoices_30d >= 0),
  active_days_30d integer not null default 0 check (active_days_30d >= 0),
  customers_30d integer not null default 0 check (customers_30d >= 0),
  known_customer_invoices_30d integer not null default 0 check (known_customer_invoices_30d >= 0),
  typical_invoice_qty_30d numeric not null default 0 check (typical_invoice_qty_30d >= 0),
  max_invoice_qty_30d numeric not null default 0 check (max_invoice_qty_30d >= 0),
  dominant_invoice_share_30d numeric not null default 0 check (dominant_invoice_share_30d between 0 and 1),
  dominant_customer_share_30d numeric check (dominant_customer_share_30d between 0 and 1),
  outlier_share_30d numeric not null default 0 check (outlier_share_30d between 0 and 1),
  behavior_class text not null check (behavior_class in ('recurring','sparse','concentrated','burst_one_off','emerging')),
  last_sale_at timestamptz not null,
  source_max_invoice_at timestamptz not null,
  source_coverage_start_at timestamptz not null,
  source_coverage_days integer not null check (source_coverage_days between 1 and 90),
  window_start timestamptz not null,
  window_end timestamptz not null,
  evidence_model_version text not null,
  source_hash text not null,
  calculated_at timestamptz not null default now(),
  imported_at timestamptz not null default now(),
  imported_by uuid references public.staff_accounts(id) on delete set null,
  primary key(branch, product_key),
  check (window_start < window_end),
  check (source_coverage_start_at <= source_max_invoice_at),
  check (source_max_invoice_at <= window_end)
);

create index if not exists idx_purchase_demand_evidence_freshness
  on public.purchase_demand_evidence_snapshots(branch, source_max_invoice_at desc);

alter table public.purchase_demand_evidence_snapshots enable row level security;
revoke all on public.purchase_demand_evidence_snapshots from anon, authenticated;

create or replace function public.smart_purchase_upsert_demand_evidence_v1(
  p_session_token text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $function$
declare
  a record;
  r jsonb;
  v_branch text;
  v_code text;
  v_key text;
  v_source_hash text;
  v_imported int := 0;
  v_unchanged int := 0;
  v_unmatched int := 0;
  v_invalid int := 0;
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
  if a.role not in ('general_manager','purchasing','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok',false,'error','rows_must_be_array');
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb))
  loop
    v_branch := nullif(trim(r->>'branch'),'');
    v_code := regexp_replace(coalesce(nullif(trim(r->>'product_code'),''),''),'\.0+$','','g');

    if v_branch not in ('دواء شكري','دواء الشامي')
       or v_code=''
       or coalesce(nullif(r->>'window_start',''),'')=''
       or coalesce(nullif(r->>'window_end',''),'')=''
       or coalesce(nullif(r->>'source_max_invoice_at',''),'')=''
       or coalesce(nullif(r->>'source_coverage_start_at',''),'')=''
       or coalesce(nullif(r->>'source_coverage_days',''),'')=''
       or coalesce(nullif(r->>'evidence_model_version',''),'')='' then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    select s.product_key into v_key
    from public.purchase_branch_current_snapshots s
    where s.branch=v_branch
      and regexp_replace(coalesce(nullif(trim(s.product_code),''),''),'\.0+$','','g')=v_code
    order by s.inventory_eligible desc, s.stock_captured_at desc nulls last
    limit 1;

    if v_key is null then
      v_unmatched := v_unmatched + 1;
      continue;
    end if;

    v_source_hash := encode(extensions.digest(
      concat_ws('|',
        v_branch,v_code,
        coalesce(r->>'units_30d','0'),
        coalesce(r->>'invoices_30d','0'),
        coalesce(r->>'active_days_30d','0'),
        coalesce(r->>'customers_30d','0'),
        coalesce(r->>'known_customer_invoices_30d','0'),
        coalesce(r->>'typical_invoice_qty_30d','0'),
        coalesce(r->>'max_invoice_qty_30d','0'),
        coalesce(r->>'dominant_invoice_share_30d','0'),
        coalesce(r->>'dominant_customer_share_30d',''),
        coalesce(r->>'outlier_share_30d','0'),
        coalesce(r->>'behavior_class',''),
        coalesce(r->>'last_sale_at',''),
        coalesce(r->>'source_max_invoice_at',''),
        coalesce(r->>'source_coverage_start_at',''),
        coalesce(r->>'source_coverage_days',''),
        coalesce(r->>'window_start',''),
        coalesce(r->>'window_end',''),
        coalesce(r->>'evidence_model_version','')
      ),'sha256'),'hex'
    );

    if exists(
      select 1 from public.purchase_demand_evidence_snapshots e
      where e.branch=v_branch and e.product_key=v_key and e.source_hash=v_source_hash
    ) then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    begin
      insert into public.purchase_demand_evidence_snapshots(
        branch,product_key,product_code,
        units_30d,invoices_30d,active_days_30d,customers_30d,known_customer_invoices_30d,
        typical_invoice_qty_30d,max_invoice_qty_30d,dominant_invoice_share_30d,
        dominant_customer_share_30d,outlier_share_30d,behavior_class,
        last_sale_at,source_max_invoice_at,source_coverage_start_at,source_coverage_days,window_start,window_end,evidence_model_version,
        source_hash,calculated_at,imported_at,imported_by
      ) values (
        v_branch,v_key,v_code,
        greatest(0,coalesce(nullif(r->>'units_30d','')::numeric,0)),
        greatest(0,coalesce(nullif(r->>'invoices_30d','')::int,0)),
        greatest(0,coalesce(nullif(r->>'active_days_30d','')::int,0)),
        greatest(0,coalesce(nullif(r->>'customers_30d','')::int,0)),
        greatest(0,coalesce(nullif(r->>'known_customer_invoices_30d','')::int,0)),
        greatest(0,coalesce(nullif(r->>'typical_invoice_qty_30d','')::numeric,0)),
        greatest(0,coalesce(nullif(r->>'max_invoice_qty_30d','')::numeric,0)),
        least(1,greatest(0,coalesce(nullif(r->>'dominant_invoice_share_30d','')::numeric,0))),
        case when nullif(r->>'dominant_customer_share_30d','') is null then null
             else least(1,greatest(0,(r->>'dominant_customer_share_30d')::numeric)) end,
        least(1,greatest(0,coalesce(nullif(r->>'outlier_share_30d','')::numeric,0))),
        case when r->>'behavior_class' in ('recurring','sparse','concentrated','burst_one_off','emerging')
             then r->>'behavior_class' else 'sparse' end,
        (r->>'last_sale_at')::timestamptz,
        (r->>'source_max_invoice_at')::timestamptz,
        (r->>'source_coverage_start_at')::timestamptz,
        greatest(1,least(90,coalesce(nullif(r->>'source_coverage_days','')::int,1))),
        (r->>'window_start')::timestamptz,
        (r->>'window_end')::timestamptz,
        r->>'evidence_model_version',
        v_source_hash,
        coalesce(nullif(r->>'calculated_at','')::timestamptz,now()),
        now(),a.id
      )
      on conflict(branch,product_key) do update set
        product_code=excluded.product_code,
        units_30d=excluded.units_30d,
        invoices_30d=excluded.invoices_30d,
        active_days_30d=excluded.active_days_30d,
        customers_30d=excluded.customers_30d,
        known_customer_invoices_30d=excluded.known_customer_invoices_30d,
        typical_invoice_qty_30d=excluded.typical_invoice_qty_30d,
        max_invoice_qty_30d=excluded.max_invoice_qty_30d,
        dominant_invoice_share_30d=excluded.dominant_invoice_share_30d,
        dominant_customer_share_30d=excluded.dominant_customer_share_30d,
        outlier_share_30d=excluded.outlier_share_30d,
        behavior_class=excluded.behavior_class,
        last_sale_at=excluded.last_sale_at,
        source_max_invoice_at=excluded.source_max_invoice_at,
        source_coverage_start_at=excluded.source_coverage_start_at,
        source_coverage_days=excluded.source_coverage_days,
        window_start=excluded.window_start,
        window_end=excluded.window_end,
        evidence_model_version=excluded.evidence_model_version,
        source_hash=excluded.source_hash,
        calculated_at=excluded.calculated_at,
        imported_at=excluded.imported_at,
        imported_by=excluded.imported_by
      where excluded.source_max_invoice_at >= public.purchase_demand_evidence_snapshots.source_max_invoice_at
        and excluded.window_end >= public.purchase_demand_evidence_snapshots.window_end
        and excluded.source_coverage_start_at <= excluded.source_max_invoice_at;

      if found then v_imported := v_imported + 1; else v_unchanged := v_unchanged + 1; end if;
    exception when others then
      v_invalid := v_invalid + 1;
    end;
  end loop;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'imported',v_imported,
    'unchanged_or_older',v_unchanged,
    'unmatched',v_unmatched,
    'invalid',v_invalid,
    'privacy_contract','aggregate_only_no_customer_or_invoice_identifiers',
    'idempotent',true
  ));
end
$function$;

revoke all on function public.smart_purchase_upsert_demand_evidence_v1(text,jsonb) from public;
grant execute on function public.smart_purchase_upsert_demand_evidence_v1(text,jsonb) to anon,authenticated;
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
  evidence_confidence_score numeric not null check (evidence_confidence_score between 0 and 100),
  evidence_quality_class text not null check (evidence_quality_class in ('high','medium','review')),
  last_sale_at timestamptz not null,
  source_max_invoice_at timestamptz not null,
  source_coverage_start_at timestamptz,
  source_coverage_days integer check (source_coverage_days between 1 and 90),
  observed_span_days integer not null check (observed_span_days between 1 and 90),
  window_start timestamptz not null,
  window_end timestamptz not null,
  evidence_model_version text not null,
  source_hash text not null,
  calculated_at timestamptz not null default now(),
  imported_at timestamptz not null default now(),
  imported_by uuid references public.staff_accounts(id) on delete set null,
  primary key(branch, product_key),
  check (window_start < window_end),
  check ((source_coverage_start_at is null and source_coverage_days is null) or (source_coverage_start_at is not null and source_coverage_days is not null)),
  check (source_coverage_start_at is null or source_coverage_start_at <= source_max_invoice_at),
  check (source_max_invoice_at >= window_start and source_max_invoice_at <= window_end),
  check (last_sale_at >= window_start and last_sale_at <= source_max_invoice_at),
  check (active_days_30d <= invoices_30d),
  check (known_customer_invoices_30d <= invoices_30d),
  check (customers_30d <= known_customer_invoices_30d),
  check (typical_invoice_qty_30d <= max_invoice_qty_30d),
  check (source_coverage_days is null or observed_span_days <= source_coverage_days)
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
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 1000 then
    return jsonb_build_object('ok',false,'error','too_many_rows','max_rows',1000);
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb))
  loop
    if jsonb_typeof(r) <> 'object' then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    v_branch := nullif(trim(r->>'branch'),'');
    v_code := regexp_replace(coalesce(nullif(trim(r->>'product_code'),''),''),'\.0+$','','g');

    if v_branch is null or v_branch not in ('دواء شكري','دواء الشامي')
       or v_code=''
       or coalesce(nullif(r->>'window_start',''),'')=''
       or coalesce(nullif(r->>'window_end',''),'')=''
       or coalesce(nullif(r->>'last_sale_at',''),'')=''
       or coalesce(nullif(r->>'source_max_invoice_at',''),'')=''
       or coalesce(nullif(r->>'observed_span_days',''),'')=''
       or coalesce(nullif(r->>'evidence_confidence_score',''),'')=''
       or coalesce(nullif(r->>'evidence_quality_class',''),'')=''
       or coalesce(nullif(r->>'evidence_model_version',''),'')=''
       or coalesce(nullif(r->>'behavior_class',''),'') not in ('recurring','sparse','concentrated','burst_one_off','emerging')
       or coalesce(nullif(r->>'evidence_quality_class',''),'') not in ('high','medium','review')
       or coalesce(nullif(r->>'units_30d',''),'')='' or (r->>'units_30d')::numeric < 0
       or coalesce(nullif(r->>'invoices_30d',''),'')='' or (r->>'invoices_30d')::int < 0
       or coalesce(nullif(r->>'active_days_30d',''),'')='' or (r->>'active_days_30d')::int < 0
       or coalesce(nullif(r->>'customers_30d',''),'')='' or (r->>'customers_30d')::int < 0
       or coalesce(nullif(r->>'known_customer_invoices_30d',''),'')='' or (r->>'known_customer_invoices_30d')::int < 0
       or coalesce(nullif(r->>'typical_invoice_qty_30d',''),'')='' or (r->>'typical_invoice_qty_30d')::numeric < 0
       or coalesce(nullif(r->>'max_invoice_qty_30d',''),'')='' or (r->>'max_invoice_qty_30d')::numeric < 0
       or coalesce(nullif(r->>'dominant_invoice_share_30d',''),'')='' or (r->>'dominant_invoice_share_30d')::numeric not between 0 and 1
       or (nullif(r->>'dominant_customer_share_30d','') is not null and (r->>'dominant_customer_share_30d')::numeric not between 0 and 1)
       or coalesce(nullif(r->>'outlier_share_30d',''),'')='' or (r->>'outlier_share_30d')::numeric not between 0 and 1
       or (r->>'evidence_confidence_score')::numeric not between 0 and 100
       or (r->>'observed_span_days')::int not between 1 and 90
       or (nullif(r->>'source_coverage_days','') is not null and (r->>'source_coverage_days')::int not between 1 and 90)
       or (r->>'active_days_30d')::int > (r->>'invoices_30d')::int
       or (r->>'known_customer_invoices_30d')::int > (r->>'invoices_30d')::int
       or (r->>'customers_30d')::int > (r->>'known_customer_invoices_30d')::int
       or (r->>'typical_invoice_qty_30d')::numeric > (r->>'max_invoice_qty_30d')::numeric
       or (nullif(r->>'source_coverage_start_at','') is null) <> (nullif(r->>'source_coverage_days','') is null)
       or (nullif(r->>'source_coverage_days','') is not null and greatest(1,coalesce(nullif(r->>'observed_span_days','')::int,1)) > greatest(1,coalesce(nullif(r->>'source_coverage_days','')::int,1)))
       or (nullif(r->>'source_coverage_days','') is null and r->>'evidence_quality_class' <> 'review')
       or (r->>'window_start')::timestamptz >= (r->>'window_end')::timestamptz
       or (nullif(r->>'source_coverage_start_at','') is not null and (r->>'source_coverage_start_at')::timestamptz > (r->>'source_max_invoice_at')::timestamptz)
       or (r->>'source_max_invoice_at')::timestamptz < (r->>'window_start')::timestamptz
       or (r->>'source_max_invoice_at')::timestamptz > (r->>'window_end')::timestamptz
       or (r->>'last_sale_at')::timestamptz < (r->>'window_start')::timestamptz
       or (r->>'last_sale_at')::timestamptz > (r->>'source_max_invoice_at')::timestamptz then
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

    -- Hash canonical parsed values, not raw JSON text. This makes semantically
    -- identical payloads (for example 1 vs 1.0) idempotent.
    v_source_hash := encode(extensions.digest(
      concat_ws('|',
        v_branch,
        v_code,
        (r->>'units_30d')::numeric::text,
        (r->>'invoices_30d')::int::text,
        (r->>'active_days_30d')::int::text,
        (r->>'customers_30d')::int::text,
        (r->>'known_customer_invoices_30d')::int::text,
        (r->>'typical_invoice_qty_30d')::numeric::text,
        (r->>'max_invoice_qty_30d')::numeric::text,
        (r->>'dominant_invoice_share_30d')::numeric::text,
        coalesce((case when nullif(r->>'dominant_customer_share_30d','') is null then null
          else (r->>'dominant_customer_share_30d')::numeric end)::text,''),
        (r->>'outlier_share_30d')::numeric::text,
        r->>'behavior_class',
        (r->>'evidence_confidence_score')::numeric::text,
        r->>'evidence_quality_class',
        (r->>'last_sale_at')::timestamptz::text,
        (r->>'source_max_invoice_at')::timestamptz::text,
        coalesce((nullif(r->>'source_coverage_start_at','')::timestamptz)::text,''),
        coalesce((nullif(r->>'source_coverage_days','')::int)::text,''),
        (r->>'observed_span_days')::int::text,
        (r->>'window_start')::timestamptz::text,
        (r->>'window_end')::timestamptz::text,
        trim(r->>'evidence_model_version')
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
        dominant_customer_share_30d,outlier_share_30d,behavior_class,evidence_confidence_score,evidence_quality_class,
        last_sale_at,source_max_invoice_at,source_coverage_start_at,source_coverage_days,observed_span_days,window_start,window_end,evidence_model_version,
        source_hash,calculated_at,imported_at,imported_by
      ) values (
        v_branch,v_key,v_code,
        (r->>'units_30d')::numeric,
        (r->>'invoices_30d')::int,
        (r->>'active_days_30d')::int,
        (r->>'customers_30d')::int,
        (r->>'known_customer_invoices_30d')::int,
        (r->>'typical_invoice_qty_30d')::numeric,
        (r->>'max_invoice_qty_30d')::numeric,
        (r->>'dominant_invoice_share_30d')::numeric,
        case when nullif(r->>'dominant_customer_share_30d','') is null then null
             else (r->>'dominant_customer_share_30d')::numeric end,
        (r->>'outlier_share_30d')::numeric,
        r->>'behavior_class',
        (r->>'evidence_confidence_score')::numeric,
        r->>'evidence_quality_class',
        (r->>'last_sale_at')::timestamptz,
        (r->>'source_max_invoice_at')::timestamptz,
        nullif(r->>'source_coverage_start_at','')::timestamptz,
        nullif(r->>'source_coverage_days','')::int,
        (r->>'observed_span_days')::int,
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
        evidence_confidence_score=excluded.evidence_confidence_score,
        evidence_quality_class=excluded.evidence_quality_class,
        last_sale_at=excluded.last_sale_at,
        source_max_invoice_at=excluded.source_max_invoice_at,
        source_coverage_start_at=excluded.source_coverage_start_at,
        source_coverage_days=excluded.source_coverage_days,
        observed_span_days=excluded.observed_span_days,
        window_start=excluded.window_start,
        window_end=excluded.window_end,
        evidence_model_version=excluded.evidence_model_version,
        source_hash=excluded.source_hash,
        calculated_at=excluded.calculated_at,
        imported_at=excluded.imported_at,
        imported_by=excluded.imported_by
      where excluded.source_max_invoice_at >= public.purchase_demand_evidence_snapshots.source_max_invoice_at
        and excluded.window_end >= public.purchase_demand_evidence_snapshots.window_end
        and (excluded.source_coverage_start_at is null or excluded.source_coverage_start_at <= excluded.source_max_invoice_at);

      if found then v_imported := v_imported + 1; else v_unchanged := v_unchanged + 1; end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or check_violation then
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
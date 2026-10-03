-- Read-only shadow comparison between current purchase profile and transaction evidence.
-- This function never updates profile, policy, stock, drafts or purchase orders.

create or replace function public.smart_purchase_demand_evidence_shadow_v1(
  p_session_token text,
  p_branch text default null
)
returns table(
  branch text,
  product_key text,
  product_code text,
  current_auto_decision_class text,
  current_behavior_class text,
  current_confidence_score numeric,
  evidence_behavior_class text,
  evidence_quality_class text,
  evidence_confidence_score numeric,
  evidence_invoices_30d integer,
  evidence_active_days_30d integer,
  evidence_customers_30d integer,
  evidence_outlier_share numeric,
  evidence_dominant_customer_share numeric,
  evidence_source_coverage_days integer,
  evidence_observed_span_days integer,
  evidence_source_max_invoice_at timestamptz,
  evidence_age_hours numeric,
  proposed_auto_decision_class text,
  comparison_status text,
  decision_change text,
  reason_codes text[]
)
language plpgsql
security definer
stable
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $function$
declare
  a record;
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

  if not found then raise exception 'invalid_session'; end if;
  if a.role not in ('general_manager','purchasing','accountant') then raise exception 'forbidden'; end if;
  if p_branch is not null and p_branch not in ('دواء شكري','دواء الشامي') then raise exception 'invalid_branch'; end if;

  return query
  with joined as (
    select
      p.branch,p.product_key,p.product_code,
      p.auto_decision_class current_auto_decision_class,
      p.behavior_class current_behavior_class,
      p.confidence_score current_confidence_score,
      e.behavior_class evidence_behavior_class,
      e.evidence_quality_class,
      e.evidence_confidence_score,
      e.invoices_30d,e.active_days_30d,e.customers_30d,e.outlier_share_30d,
      e.dominant_customer_share_30d,e.source_coverage_days,e.observed_span_days,e.source_max_invoice_at,
      case
        when e.product_key is null then p.auto_decision_class
        when e.source_coverage_days is null then p.auto_decision_class
        when e.source_coverage_days < 15 then 'review'
        when e.evidence_quality_class='high'
             and coalesce(p.movement_history_months,0)>=2
             and coalesce(p.demand_stability_score,0)>=60
             and e.behavior_class not in ('burst_one_off','sparse')
          then 'high'
        when e.evidence_quality_class in ('high','medium')
             and coalesce(p.movement_history_months,0)>=2
             and coalesce(p.demand_stability_score,0)>=35
             and e.behavior_class <> 'burst_one_off'
          then 'medium'
        else 'review'
      end proposed
    from public.purchase_inventory_intelligence_profiles p
    left join public.purchase_demand_evidence_snapshots e
      on e.branch=p.branch and e.product_key=p.product_key
    where p_branch is null or p.branch=p_branch
  )
  select
    j.branch,j.product_key,j.product_code,
    j.current_auto_decision_class,j.current_behavior_class,j.current_confidence_score,
    j.evidence_behavior_class,j.evidence_quality_class,j.evidence_confidence_score,
    j.invoices_30d,j.active_days_30d,j.customers_30d,j.outlier_share_30d,
    j.dominant_customer_share_30d,j.source_coverage_days,j.observed_span_days,j.source_max_invoice_at,
    case when j.source_max_invoice_at is null then null
         else round((extract(epoch from (now()-j.source_max_invoice_at))/3600.0)::numeric,1) end,
    j.proposed,
    case
      when j.evidence_quality_class is null then 'insufficient_evidence'
      when j.source_coverage_days is null then 'insufficient_evidence'
      else 'comparable'
    end,
    case
      when j.evidence_quality_class is null or j.source_coverage_days is null then 'not_compared'
      when coalesce(j.current_auto_decision_class,'review')=j.proposed then 'same'
         else coalesce(j.current_auto_decision_class,'review')||'->'||j.proposed end,
    array_remove(array[
      case when j.evidence_behavior_class='burst_one_off' then 'bulk_burst' end,
      case when j.evidence_behavior_class='concentrated' then 'customer_concentration' end,
      case when j.evidence_quality_class is not null and j.source_coverage_days is null then 'unproven_source_coverage' end,
      case when j.source_coverage_days is not null and j.source_coverage_days<15 then 'partial_source_coverage' end,
      case when j.evidence_quality_class='review' then 'weak_transaction_evidence' end,
      case when j.evidence_quality_class is null then 'missing_transaction_evidence' end
    ],null)::text[]
  from joined j;
end
$function$;

revoke all on function public.smart_purchase_demand_evidence_shadow_v1(text,text) from public;
grant execute on function public.smart_purchase_demand_evidence_shadow_v1(text,text) to anon,authenticated;

-- Aggregate-only summary of the shadow output. Read-only by construction.
create or replace function public.smart_purchase_demand_evidence_shadow_summary_v1(
  p_session_token text,
  p_branch text default null
) returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $summary$
  with s as (
    select *
    from public.smart_purchase_demand_evidence_shadow_v1(p_session_token,p_branch)
  )
  select jsonb_build_object(
    'mode','shadow_read_only',
    'total_profiles',count(*),
    'comparable',count(*) filter (where comparison_status='comparable'),
    'insufficient_evidence',count(*) filter (where comparison_status='insufficient_evidence'),
    'same',count(*) filter (where comparison_status='comparable' and decision_change='same'),
    'high_to_medium',count(*) filter (where comparison_status='comparable' and current_auto_decision_class='high' and proposed_auto_decision_class='medium'),
    'high_to_review',count(*) filter (where comparison_status='comparable' and current_auto_decision_class='high' and proposed_auto_decision_class='review'),
    'medium_to_review',count(*) filter (where comparison_status='comparable' and current_auto_decision_class='medium' and proposed_auto_decision_class='review'),
    'possible_upgrade',count(*) filter (where comparison_status='comparable' and coalesce(current_auto_decision_class,'review')='review' and proposed_auto_decision_class in ('medium','high')),
    'missing_evidence',count(*) filter (where evidence_quality_class is null),
    'unproven_coverage',count(*) filter (where evidence_quality_class is not null and evidence_source_coverage_days is null),
    'oldest_evidence_age_hours',max(evidence_age_hours) filter (where comparison_status='comparable'),
    'newest_evidence_age_hours',min(evidence_age_hours) filter (where comparison_status='comparable'),
    'bulk_burst',count(*) filter (where evidence_behavior_class='burst_one_off'),
    'concentrated',count(*) filter (where evidence_behavior_class='concentrated'),
    'partial_coverage',count(*) filter (where evidence_source_coverage_days is not null and evidence_source_coverage_days<15),
    'quality_high',count(*) filter (where evidence_quality_class='high'),
    'quality_medium',count(*) filter (where evidence_quality_class='medium'),
    'quality_review',count(*) filter (where evidence_quality_class='review')
  )
  from s
$summary$;

revoke all on function public.smart_purchase_demand_evidence_shadow_summary_v1(text,text) from public;
grant execute on function public.smart_purchase_demand_evidence_shadow_summary_v1(text,text) to anon,authenticated;
create or replace function public.treasury_shift_sales_intelligence_v1(
  p_session_token text,
  p_branch text default 'all',
  p_shift_type text default 'all',
  p_days integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_role text;
  v_allowed_branches text[];
  v_days integer := least(greatest(coalesce(p_days,14),1),90);
  v_start date := current_date - (least(greatest(coalesce(p_days,14),1),90) - 1);
  v_data jsonb;
begin
  select a.role,
         case
           when jsonb_typeof(coalesce(a.branch_ids,'[]'::jsonb))='array'
             then coalesce(array(select jsonb_array_elements_text(coalesce(a.branch_ids,'[]'::jsonb))),array[]::text[])
           else array[]::text[]
         end
    into v_role,v_allowed_branches
  from public.staff_sessions s
  join public.staff_accounts a on a.id=s.account_id
  where s.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null
    and s.expires_at>now()
    and a.status='active'
  order by s.created_at desc
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  if v_role not in ('general_manager','branch_manager','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if coalesce(p_branch,'all')<>'all' and v_role<>'general_manager'
     and not (p_branch=any(v_allowed_branches)) then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  with base as (
    select sd.*
    from public.shift_deliveries sd
    where sd.shift_date between v_start and current_date
      and (coalesce(p_branch,'all')='all' or sd.branch=p_branch)
      and (coalesce(p_shift_type,'all')='all' or sd.shift_type=p_shift_type)
      and (v_role='general_manager' or cardinality(v_allowed_branches)=0 or sd.branch=any(v_allowed_branches))
  ), classified as (
    select
      b.id,b.branch,b.shift_type,b.shift_date,b.total_sales,b.total_expenses,b.net_amount,b.treasury_status,b.status,b.created_at,
      coalesce((select sum(coalesce(nullif(e->>'amount','')::numeric,0)) from jsonb_array_elements(coalesce(b.expenses,'[]'::jsonb)) e where lower(trim(coalesce(e->>'category',''))) in ('انستا','انستاباي','instapay','insta pay')),0) as instapay,
      coalesce((select sum(coalesce(nullif(e->>'amount','')::numeric,0)) from jsonb_array_elements(coalesce(b.expenses,'[]'::jsonb)) e where lower(trim(coalesce(e->>'category',''))) like '%فودافون%' or lower(trim(coalesce(e->>'category',''))) like '%vodafone%'),0) as vodafone_cash,
      coalesce((select sum(coalesce(nullif(e->>'amount','')::numeric,0)) from jsonb_array_elements(coalesce(b.expenses,'[]'::jsonb)) e where lower(trim(coalesce(e->>'category',''))) in ('فيزا','visa','card','بطاقة')),0) as visa,
      coalesce((select sum(coalesce(nullif(e->>'amount','')::numeric,0)) from jsonb_array_elements(coalesce(b.expenses,'[]'::jsonb)) e where lower(trim(coalesce(e->>'category',''))) in ('تحويل داخلي','internal transfer')),0) as internal_transfer,
      coalesce((select sum(coalesce(nullif(e->>'amount','')::numeric,0)) from jsonb_array_elements(coalesce(b.expenses,'[]'::jsonb)) e
        where (e->>'entry_type'='collection')
          and lower(trim(coalesce(e->>'category',''))) not in ('نقدي','cash','انستا','انستاباي','instapay','insta pay','فيزا','visa','card','بطاقة','تحويل داخلي','internal transfer')
          and not (lower(trim(coalesce(e->>'category',''))) like '%فودافون%' or lower(trim(coalesce(e->>'category',''))) like '%vodafone%')
      ),0) as other_non_cash,
      coalesce((select sum(coalesce(nullif(e->>'amount','')::numeric,0)) from jsonb_array_elements(coalesce(b.expenses,'[]'::jsonb)) e
        where e->>'entry_type'='expense'
           or ((e->>'entry_type') is null
             and lower(trim(coalesce(e->>'category',''))) not in ('انستا','انستاباي','instapay','insta pay','فيزا','visa','card','بطاقة','تحويل داخلي','internal transfer')
             and not (lower(trim(coalesce(e->>'category',''))) like '%فودافون%' or lower(trim(coalesce(e->>'category',''))) like '%vodafone%'))
      ),0) as true_expenses
    from base b
  ), enriched as (
    select c.*,
      (c.instapay+c.vodafone_cash+c.visa+c.internal_transfer+c.other_non_cash) as non_cash_total,
      greatest(coalesce(c.total_sales,0)-(c.instapay+c.vodafone_cash+c.visa+c.internal_transfer+c.other_non_cash)-c.true_expenses,0) as calculated_net,
      coalesce(c.net_amount,0)-greatest(coalesce(c.total_sales,0)-(c.instapay+c.vodafone_cash+c.visa+c.internal_transfer+c.other_non_cash)-c.true_expenses,0) as net_gap
    from classified c
  ), totals as (
    select
      count(*)::int shift_count,
      coalesce(sum(total_sales),0) total_sales,
      coalesce(sum(net_amount),0) recorded_net,
      coalesce(sum(calculated_net),0) calculated_net,
      coalesce(sum(instapay),0) instapay,
      coalesce(sum(vodafone_cash),0) vodafone_cash,
      coalesce(sum(visa),0) visa,
      coalesce(sum(internal_transfer),0) internal_transfer,
      coalesce(sum(other_non_cash),0) other_non_cash,
      coalesce(sum(non_cash_total),0) non_cash_total,
      coalesce(sum(true_expenses),0) true_expenses,
      coalesce(avg(total_sales),0) avg_sales_per_shift,
      count(*) filter(where abs(net_gap)>1)::int net_gap_shifts,
      count(*) filter(where coalesce(total_sales,0)>0 and non_cash_total/coalesce(total_sales,1)>.70)::int high_non_cash_shifts
    from enriched
  ), today as (
    select
      coalesce(sum(total_sales),0) sales,
      coalesce(sum(calculated_net),0) calculated_net,
      coalesce(sum(instapay),0) instapay,
      coalesce(sum(vodafone_cash),0) vodafone_cash,
      coalesce(sum(non_cash_total),0) non_cash_total,
      count(*)::int shift_count
    from enriched where shift_date=current_date
  ), yesterday as (
    select
      coalesce(sum(total_sales),0) sales,
      coalesce(sum(calculated_net),0) calculated_net,
      coalesce(sum(instapay),0) instapay,
      coalesce(sum(vodafone_cash),0) vodafone_cash,
      coalesce(sum(non_cash_total),0) non_cash_total,
      count(*)::int shift_count
    from enriched where shift_date=current_date-1
  ), daily as (
    select shift_date,
      coalesce(sum(total_sales),0) sales,
      coalesce(sum(calculated_net),0) calculated_net,
      coalesce(sum(instapay),0) instapay,
      coalesce(sum(vodafone_cash),0) vodafone_cash,
      coalesce(sum(visa),0) visa,
      coalesce(sum(internal_transfer),0) internal_transfer,
      coalesce(sum(non_cash_total),0) non_cash_total,
      count(*)::int shift_count
    from enriched group by shift_date
  ), by_branch as (
    select branch,
      coalesce(sum(total_sales),0) sales,
      coalesce(sum(calculated_net),0) calculated_net,
      coalesce(sum(instapay),0) instapay,
      coalesce(sum(vodafone_cash),0) vodafone_cash,
      coalesce(sum(visa),0) visa,
      coalesce(sum(internal_transfer),0) internal_transfer,
      coalesce(sum(non_cash_total),0) non_cash_total,
      count(*)::int shift_count
    from enriched group by branch
  ), by_shift as (
    select shift_type,
      coalesce(sum(total_sales),0) sales,
      coalesce(sum(calculated_net),0) calculated_net,
      coalesce(sum(instapay),0) instapay,
      coalesce(sum(vodafone_cash),0) vodafone_cash,
      coalesce(sum(non_cash_total),0) non_cash_total,
      count(*)::int shift_count
    from enriched group by shift_type
  )
  select jsonb_build_object(
    'period',jsonb_build_object('days',v_days,'start_date',v_start,'end_date',current_date),
    'kpis',(select to_jsonb(t) || jsonb_build_object(
      'non_cash_share_pct',case when t.total_sales>0 then round((t.non_cash_total/t.total_sales*100)::numeric,2) else 0 end,
      'calculated_net_share_pct',case when t.total_sales>0 then round((t.calculated_net/t.total_sales*100)::numeric,2) else 0 end
    ) from totals t),
    'today',(select to_jsonb(t) from today t),
    'yesterday',(select to_jsonb(y) from yesterday y),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by d.shift_date) from daily d),'[]'::jsonb),
    'branches',coalesce((select jsonb_agg(to_jsonb(b) order by b.sales desc) from by_branch b),'[]'::jsonb),
    'shifts',coalesce((select jsonb_agg(to_jsonb(s) order by s.sales desc) from by_shift s),'[]'::jsonb)
  ) into v_data;

  return jsonb_build_object('ok',true,'data',v_data);
end;
$function$;

grant execute on function public.treasury_shift_sales_intelligence_v1(text,text,text,integer) to anon, authenticated;

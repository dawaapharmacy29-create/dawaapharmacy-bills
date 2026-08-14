create or replace function public.treasury_shift_review_list(
  p_session_token text,
  p_branch text default null,
  p_shift_type text default null,
  p_limit integer default 1000,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_role text;
  v_allowed_branches text[];
  v_rows jsonb;
  v_limit integer := least(greatest(coalesce(p_limit,1000),1),5000);
  v_offset integer := greatest(coalesce(p_offset,0),0);
begin
  select a.role,
         case when jsonb_typeof(coalesce(a.branch_ids,'[]'::jsonb))='array'
              then coalesce(array(select jsonb_array_elements_text(coalesce(a.branch_ids,'[]'::jsonb))),array[]::text[])
              else array[]::text[] end
    into v_role,v_allowed_branches
  from public.staff_sessions s
  join public.staff_accounts a on a.id=s.account_id
  where s.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>now() and a.status='active'
  order by s.created_at desc limit 1;

  if v_role is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_role not in ('general_manager','branch_manager','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  if p_branch is not null and p_branch<>'all' and v_role<>'general_manager' and not (p_branch=any(v_allowed_branches)) then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  with base as (
    select sd.*,
      coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e where e->>'entry_type'='collection' and e->>'category'='نقدي'),0) cash_sales,
      coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e where e->>'entry_type'='collection' and e->>'category'='فيزا'),0) card_sales,
      coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e where e->>'entry_type'='collection' and e->>'category'='تحويل'),0) transfer_sales,
      coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e where e->>'entry_type'='cash_control' and e->>'category'='رصيد افتتاحي'),0) opening_cash,
      coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e where e->>'entry_type'='cash_control' and e->>'category'='نقدية متوقعة'),0) expected_cash,
      coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e where e->>'entry_type'='cash_control' and e->>'category'='نقدية فعلية'),0) actual_cash,
      coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e where e->>'entry_type'='cash_control' and e->>'category'='فرق الخزنة'),0) cash_difference,
      exists(select 1 from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e where e->>'entry_type'='collection') has_collections,
      exists(select 1 from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e where e->>'entry_type'='cash_control') has_cash_control,
      coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e
                where coalesce(e->>'entry_type','')='' and lower(trim(coalesce(e->>'category',''))) = any(array['انستا','انستاباي','instapay','فودافون كاش','vodafone cash','تحويل داخلي','فيزا','visa'])),0) legacy_non_cash,
      coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(sd.expenses,'[]'::jsonb)) e
                where coalesce(e->>'entry_type','')='' and not (lower(trim(coalesce(e->>'category',''))) = any(array['انستا','انستاباي','instapay','فودافون كاش','vodafone cash','تحويل داخلي','فيزا','visa']))),0) legacy_true_expenses
    from public.shift_deliveries sd
    where coalesce(sd.treasury_status,'pending') in ('pending','pending_review')
      and (p_branch is null or p_branch='all' or sd.branch=p_branch)
      and (p_shift_type is null or p_shift_type='all' or sd.shift_type=p_shift_type)
      and (v_role='general_manager' or cardinality(v_allowed_branches)=0 or sd.branch=any(v_allowed_branches))
  ), enriched as (
    select b.*,
      case when b.has_collections and b.has_cash_control then 'complete' when b.has_collections then 'collections_only' else 'legacy' end data_quality,
      case when b.has_collections then abs(coalesce(b.total_sales,0)-(b.cash_sales+b.card_sales+b.transfer_sales)) else null end sales_reconciliation_gap,
      case when b.has_cash_control then abs(b.cash_difference-(b.actual_cash-b.expected_cash)) else null end cash_reconciliation_gap,
      case when not b.has_collections then coalesce(b.total_sales,0)-b.legacy_non_cash-b.legacy_true_expenses else b.expected_cash end derived_cash_to_handover
    from base b
  ), limited as (
    select * from enriched order by shift_date desc,created_at desc limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'branch',branch,'shift_type',shift_type,'shift_date',shift_date,'submitted_by',submitted_by,
    'total_sales',total_sales,'total_expenses',total_expenses,'net_amount',net_amount,'status',status,'treasury_status',treasury_status,
    'notes',notes,'treasury_review_note',treasury_review_note,'created_at',created_at,'updated_at',updated_at,'imported_at',imported_at,'expenses',expenses,
    'cash_sales',cash_sales,'card_sales',card_sales,'transfer_sales',transfer_sales,'opening_cash',opening_cash,'expected_cash',expected_cash,'actual_cash',actual_cash,'cash_difference',cash_difference,
    'legacy_non_cash',legacy_non_cash,'legacy_true_expenses',legacy_true_expenses,'derived_cash_to_handover',derived_cash_to_handover,
    'data_quality',data_quality,'sales_reconciliation_gap',sales_reconciliation_gap,'cash_reconciliation_gap',cash_reconciliation_gap
  ) order by shift_date desc,created_at desc),'[]'::jsonb) into v_rows from limited;

  return jsonb_build_object('ok',true,'data',v_rows,'count',jsonb_array_length(v_rows));
end;
$function$;

grant execute on function public.treasury_shift_review_list(text,text,text,integer,integer) to anon,authenticated;

create or replace function public.smart_purchase_supplier_decision_v2(
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare
  a record;
  o public.smart_purchase_orders%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  perform set_config('statement_timeout','25000',true);
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  select * into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if a.role='branch_manager' and not (
    coalesce(a.branch_ids,'[]'::jsonb)?coalesce(o.branch,'') or
    coalesce(a.branch_ids,'[]'::jsonb)?replace(coalesce(o.branch,''),'دواء ','') or
    coalesce(a.branch_ids,'[]'::jsonb)?replace(coalesce(o.branch,''),'فرع ','')
  ) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  with items as (
    select i.id item_id,i.product_code,i.product_name,
      greatest(0,coalesce(nullif(i.approved_quantity,0),i.requested_quantity,0))::numeric needed_qty,
      greatest(0,coalesce(i.customer_requests_count,0))::int customer_requests_count,
      greatest(0,coalesce(i.priority_score,0))::numeric priority_score,
      case when coalesce(i.customer_requests_count,0)>0 or coalesce(i.priority_score,0)>=75 then true else false end urgent
    from public.smart_purchase_order_items i
    where i.order_id=p_order_id
      and greatest(0,coalesce(nullif(i.approved_quantity,0),i.requested_quantity,0))>0
  ), performance_base as (
    select r.supplier_name,r.id receipt_id,r.order_id,r.receipt_date,r.completion_rate,r.price_score,r.delay_days,
      i.quantity_variance,i.expected_unit_cost,i.actual_unit_cost,i.received_quantity
    from public.purchase_order_receipts r
    join public.smart_purchase_orders po on po.id=r.order_id
    left join public.purchase_order_receipt_items i on i.receipt_id=r.id
    where nullif(trim(r.supplier_name),'') is not null
      and r.receipt_date>=current_date-365
      and (po.branch=o.branch or o.branch is null)
  ), performance_agg as (
    select supplier_name,
      count(distinct receipt_id)::int receipt_count,
      round(avg(completion_rate)::numeric,1) completion_rate,
      round(avg(price_score)::numeric,1) price_adherence,
      count(distinct receipt_id) filter(where delay_days is not null)::int delivery_observations,
      round(100.0*count(distinct receipt_id) filter(where delay_days is not null and delay_days=0)/nullif(count(distinct receipt_id) filter(where delay_days is not null),0),1) on_time_rate,
      round(100.0*count(distinct receipt_id) filter(where completion_rate>=95 and price_score>=98)/nullif(count(distinct receipt_id),0),1) clean_receipt_rate,
      round(sum(greatest(0,-quantity_variance)*expected_unit_cost)::numeric,2) shortage_value,
      round(sum(greatest(0,actual_unit_cost-expected_unit_cost)*received_quantity)::numeric,2) price_overpay_value
    from performance_base
    group by supplier_name
  ), performance as (
    select p.*,
      round(greatest(0,least(100,
        case when delivery_observations>0 then
          coalesce(completion_rate,0)*0.45+coalesce(price_adherence,0)*0.25+coalesce(on_time_rate,0)*0.20+coalesce(clean_receipt_rate,0)*0.10
        else
          coalesce(completion_rate,0)*0.60+coalesce(price_adherence,0)*0.30+coalesce(clean_receipt_rate,0)*0.10
        end
      )),1) performance_score,
      least(100,round(receipt_count*12.5,0))::int confidence,
      case when receipt_count<3 then 'تعلم أولي' when receipt_count<8 then 'ثقة متوسطة' else 'ثقة عالية' end confidence_label
    from performance_agg p
  ), offers0 as (
    select it.*,sp.id offer_id,sp.supplier_id,sp.supplier_name,
      greatest(0,coalesce(sp.list_price,0))::numeric list_price,
      greatest(0,coalesce(sp.discount_percent,0))::numeric discount_percent,
      greatest(0,coalesce(sp.extra_discount_percent,0))::numeric extra_discount_percent,
      greatest(0,coalesce(sp.net_unit_cost,
        greatest(0,coalesce(sp.list_price,0))*(1-greatest(0,least(100,coalesce(sp.discount_percent,0)))/100.0)*(1-greatest(0,least(100,coalesce(sp.extra_discount_percent,0)))/100.0),0))::numeric net_unit_cost,
      greatest(0,coalesce(sp.minimum_order_quantity,0))::numeric moq,
      greatest(0,coalesce(sp.available_quantity,0))::numeric available_quantity,
      greatest(0,coalesce(sp.bonus_base_quantity,0))::numeric bonus_base_quantity,
      greatest(0,coalesce(sp.bonus_quantity,0))::numeric bonus_quantity,
      greatest(0,coalesce(sp.lead_time_days,0))::int lead_time_days,
      coalesce(nullif(trim(sp.payment_type),''),nullif(trim(s.payment_type),''),'غير محدد') payment_type,
      greatest(0,coalesce(s.payment_terms_days,0))::int payment_terms_days,
      sp.valid_until,coalesce(sp.is_available,true) is_available,
      pf.receipt_count,pf.performance_score,pf.confidence,pf.confidence_label,pf.completion_rate,
      pf.price_adherence,pf.on_time_rate,pf.shortage_value,pf.price_overpay_value
    from items it
    join public.supplier_product_offers sp on (
      (nullif(trim(it.product_code),'') is not null and sp.product_code=it.product_code)
      or lower(regexp_replace(trim(sp.product_name),'[\s_\-]+',' ','g'))=lower(regexp_replace(trim(it.product_name),'[\s_\-]+',' ','g'))
    )
    left join public.suppliers s on s.id=sp.supplier_id
    left join performance pf on lower(trim(pf.supplier_name))=lower(trim(sp.supplier_name))
    where coalesce(sp.is_available,true)=true and (sp.valid_until is null or sp.valid_until>=current_date)
  ), offers1 as (
    select x.*,
      greatest(needed_qty,moq)::numeric purchase_qty,
      greatest(0,greatest(needed_qty,moq)-needed_qty)::numeric overbuy_units,
      case when bonus_base_quantity>0 and bonus_quantity>0 and greatest(needed_qty,moq)>=bonus_base_quantity
        then floor(greatest(needed_qty,moq)/bonus_base_quantity)*bonus_quantity else 0 end::numeric earned_bonus_units
    from offers0 x where net_unit_cost>0
  ), offers2 as (
    select x.*,(purchase_qty+earned_bonus_units)::numeric received_units,
      round((purchase_qty*net_unit_cost)::numeric,2) cash_cost,
      case when purchase_qty+earned_bonus_units>0 then round(((purchase_qty*net_unit_cost)/(purchase_qty+earned_bonus_units))::numeric,4) else net_unit_cost end effective_unit_cost,
      case when available_quantity>0 and available_quantity<purchase_qty then false else true end quantity_fully_available,
      case when available_quantity<=0 then true else false end availability_unknown
    from offers1 x
  ), offers3 as (
    select x.*,min(effective_unit_cost) over(partition by item_id) best_effective_cost
    from offers2 x
  ), commercial as (
    select x.*,
      greatest(0,least(100,
        100
        -case when best_effective_cost>0 then least(40,((effective_unit_cost-best_effective_cost)/best_effective_cost*50)) else 0 end
        -least(25,lead_time_days*(case when urgent then 4 else 1.5 end))
        -case when needed_qty>0 then least(25,(overbuy_units/needed_qty*20)) else 0 end
        -case when quantity_fully_available then 0 else 50 end
        +least(10,payment_terms_days/3.0)
        +least(8,case when purchase_qty>0 then earned_bonus_units/purchase_qty*20 else 0 end)
      ))::numeric commercial_score
    from offers3 x
  ), scored as (
    select c.*,
      case when performance_score is null or confidence is null then 0::numeric else
        greatest(-12.5,least(12.5,
          (performance_score-75.0)*(confidence/100.0)*0.35*(case when urgent then 1.25 else 1.0 end)
        )) end::numeric performance_adjustment,
      greatest(0,least(100,
        commercial_score + case when performance_score is null or confidence is null then 0 else
          greatest(-12.5,least(12.5,(performance_score-75.0)*(confidence/100.0)*0.35*(case when urgent then 1.25 else 1.0 end))) end
      ))::numeric recommendation_score
    from commercial c
  ), ranked as (
    select s.*,row_number() over(partition by item_id order by recommendation_score desc,effective_unit_cost asc,lead_time_days asc,cash_cost asc) rn
    from scored s
  ), item_json as (
    select it.item_id,it.product_code,it.product_name,it.needed_qty,it.customer_requests_count,it.priority_score,it.urgent,
      coalesce((select jsonb_build_object(
        'offer_id',r.offer_id,'supplier_id',r.supplier_id,'supplier_name',r.supplier_name,
        'needed_qty',r.needed_qty,'purchase_qty',r.purchase_qty,'overbuy_units',r.overbuy_units,
        'earned_bonus_units',r.earned_bonus_units,'received_units',r.received_units,
        'net_unit_cost',r.net_unit_cost,'effective_unit_cost',r.effective_unit_cost,'cash_cost',r.cash_cost,
        'minimum_order_quantity',r.moq,'available_quantity',r.available_quantity,
        'quantity_fully_available',r.quantity_fully_available,'availability_unknown',r.availability_unknown,
        'lead_time_days',r.lead_time_days,'payment_type',r.payment_type,'payment_terms_days',r.payment_terms_days,
        'valid_until',r.valid_until,'commercial_score',round(r.commercial_score,1),
        'performance_score',r.performance_score,'performance_confidence',r.confidence,
        'performance_confidence_label',r.confidence_label,'performance_adjustment',round(r.performance_adjustment,1),
        'recommendation_score',round(r.recommendation_score,1),
        'receipt_count',coalesce(r.receipt_count,0),'completion_rate',r.completion_rate,
        'price_adherence',r.price_adherence,'on_time_rate',r.on_time_rate,
        'shortage_value',coalesce(r.shortage_value,0),'price_overpay_value',coalesce(r.price_overpay_value,0),
        'reason',concat_ws(' • ',
          case when r.effective_unit_cost=r.best_effective_cost then 'أفضل تكلفة فعالة' else null end,
          case when r.earned_bonus_units>0 then 'يشمل بونص فعلي على الكمية' else null end,
          case when r.overbuy_units>0 then concat('MOQ يضيف ',r.overbuy_units,' وحدة زيادة') else null end,
          case when not r.quantity_fully_available then 'الكمية المتاحة لا تكفي' else null end,
          case when r.availability_unknown then 'الكمية المتاحة غير محددة' else null end,
          case when r.lead_time_days>2 and it.urgent then 'مدة التوريد طويلة لصنف عاجل' else null end,
          case when r.payment_terms_days>0 then concat('أجل ',r.payment_terms_days,' يوم') else null end,
          case when r.performance_score is null then 'لا يوجد تاريخ استلام فعلي بعد' end,
          case when r.performance_adjustment>=2 then concat('الأداء الفعلي رفع الترتيب +',round(r.performance_adjustment,1)) end,
          case when r.performance_adjustment<=-2 then concat('الأداء الفعلي خفض الترتيب ',round(r.performance_adjustment,1)) end,
          case when r.performance_score is not null and coalesce(r.confidence,0)<38 then 'تاريخ المورد ما زال بعينة صغيرة ووزنه محدود' end
        )
      ) from ranked r where r.item_id=it.item_id and r.rn=1),'null'::jsonb) recommended,
      coalesce((select jsonb_agg(jsonb_build_object(
        'offer_id',r.offer_id,'supplier_name',r.supplier_name,'purchase_qty',r.purchase_qty,
        'earned_bonus_units',r.earned_bonus_units,'effective_unit_cost',r.effective_unit_cost,'cash_cost',r.cash_cost,
        'lead_time_days',r.lead_time_days,'payment_terms_days',r.payment_terms_days,
        'quantity_fully_available',r.quantity_fully_available,'commercial_score',round(r.commercial_score,1),
        'performance_score',r.performance_score,'performance_confidence',r.confidence,
        'performance_adjustment',round(r.performance_adjustment,1),'recommendation_score',round(r.recommendation_score,1)
      ) order by r.rn) from ranked r where r.item_id=it.item_id and r.rn<=3),'[]'::jsonb) alternatives,
      (select count(*) from ranked r where r.item_id=it.item_id)::int offer_count
    from items it
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id',item_id,'product_code',product_code,'product_name',product_name,'needed_qty',needed_qty,
      'customer_requests_count',customer_requests_count,'priority_score',priority_score,'urgent',urgent,
      'offer_count',offer_count,'recommended',recommended,'alternatives',alternatives,
      'status',case when offer_count=0 then 'no_offer'
        when coalesce((recommended->>'quantity_fully_available')::boolean,false)=false then 'availability_gap'
        when coalesce((recommended->>'overbuy_units')::numeric,0)>0 then 'moq_overbuy' else 'ready' end
    ) order by urgent desc,priority_score desc,product_name),'[]'::jsonb),
    jsonb_build_object(
      'items',count(*),
      'ready',count(*) filter(where offer_count>0 and coalesce((recommended->>'quantity_fully_available')::boolean,false)=true),
      'without_offers',count(*) filter(where offer_count=0),
      'availability_gaps',count(*) filter(where offer_count>0 and coalesce((recommended->>'quantity_fully_available')::boolean,false)=false),
      'moq_overbuy_items',count(*) filter(where coalesce((recommended->>'overbuy_units')::numeric,0)>0),
      'recommended_cash_cost',round(coalesce(sum(coalesce((recommended->>'cash_cost')::numeric,0)),0)::numeric,2),
      'estimated_bonus_units',round(coalesce(sum(coalesce((recommended->>'earned_bonus_units')::numeric,0)),0)::numeric,2),
      'history_influenced_items',count(*) filter(where abs(coalesce((recommended->>'performance_adjustment')::numeric,0))>=2)
    )
  into v_items,v_summary from item_json;

  return jsonb_build_object(
    'ok',true,
    'order',jsonb_build_object('id',o.id,'order_number',o.order_number,'title',o.title,'branch',o.branch,'status',o.status),
    'summary',v_summary,'items',v_items,'offers_loaded',(select count(*) from public.supplier_product_offers),
    'method',jsonb_build_object(
      'note','استشارة قبل الاعتماد فقط؛ لا يتم تغيير المورد أو الكميات تلقائيًا.',
      'commercial_ranking','التكلفة الفعالة بعد البونص + MOQ + توافر الكمية + سرعة التوريد + أجل السداد.',
      'performance_ranking','الأداء الفعلي يبدأ من نقطة حيادية 75، ويؤثر تدريجيًا حسب الثقة. لا تاريخ = لا تأثير.',
      'confidence_guard','الاستلامات القليلة لها وزن صغير؛ التأثير الأقصى ±12.5 نقطة، ويزيد قليلًا للأصناف العاجلة.',
      'availability','available_quantity = 0 تعامل ككمية غير محددة وليس كعدم توافر، طالما is_available=true.'
    )
  );
end;
$$;

grant execute on function public.smart_purchase_supplier_decision_v2(text,uuid) to anon,authenticated;

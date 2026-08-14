create or replace function public.smart_purchase_supplier_allocation_plan_v1(
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare
  v_decision jsonb;
  v_item jsonb;
  v_candidate jsonb;
  v_offer public.supplier_product_offers%rowtype;
  v_lines jsonb;
  v_items jsonb := '[]'::jsonb;
  v_remaining numeric;
  v_needed numeric;
  v_take numeric;
  v_purchase_qty numeric;
  v_bonus numeric;
  v_received numeric;
  v_cash numeric;
  v_effective numeric;
  v_moq numeric;
  v_available numeric;
  v_line_count integer;
  v_total_cash numeric := 0;
  v_total_bonus numeric := 0;
  v_total_overbuy numeric := 0;
  v_total_unresolved numeric := 0;
  v_covered_items integer := 0;
  v_split_items integer := 0;
  v_item_count integer := 0;
  v_supplier_names text[];
  v_score numeric;
begin
  perform set_config('statement_timeout','25000',true);

  v_decision := public.smart_purchase_supplier_decision_v2(p_session_token,p_order_id);
  if coalesce((v_decision->>'ok')::boolean,false) is not true then
    return v_decision;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_decision->'items','[]'::jsonb)) loop
    v_item_count := v_item_count + 1;
    v_needed := greatest(0,coalesce(nullif(v_item->>'needed_qty','')::numeric,0));
    v_remaining := v_needed;
    v_lines := '[]'::jsonb;
    v_line_count := 0;
    v_supplier_names := array[]::text[];

    for v_candidate in
      select value from jsonb_array_elements(coalesce(v_item->'alternatives','[]'::jsonb))
    loop
      exit when v_remaining <= 0.0001;
      select * into v_offer from public.supplier_product_offers
      where id=nullif(v_candidate->>'offer_id','')::uuid
        and coalesce(is_available,true)=true
        and (valid_until is null or valid_until>=current_date);
      if not found then continue; end if;

      v_available := greatest(0,coalesce(v_offer.available_quantity,0));
      v_moq := greatest(0,coalesce(v_offer.minimum_order_quantity,0));
      v_take := case when v_available>0 then least(v_remaining,v_available) else v_remaining end;
      if v_take<=0 then continue; end if;

      v_purchase_qty := greatest(v_take,v_moq);
      if v_available>0 and v_purchase_qty>v_available then
        -- A supplier that cannot satisfy its own MOQ is not a feasible split line.
        continue;
      end if;

      v_bonus := case
        when coalesce(v_offer.bonus_base_quantity,0)>0 and coalesce(v_offer.bonus_quantity,0)>0 and v_purchase_qty>=v_offer.bonus_base_quantity
          then floor(v_purchase_qty/v_offer.bonus_base_quantity)*v_offer.bonus_quantity
        else 0 end;
      v_received := v_purchase_qty + v_bonus;
      v_cash := round(v_purchase_qty*greatest(0,coalesce(v_offer.net_unit_cost,
        greatest(0,coalesce(v_offer.list_price,0))*(1-greatest(0,least(100,coalesce(v_offer.discount_percent,0)))/100.0)*(1-greatest(0,least(100,coalesce(v_offer.extra_discount_percent,0)))/100.0)
      ,0)),2);
      v_effective := case when v_received>0 then round(v_cash/v_received,4) else 0 end;
      v_score := coalesce(nullif(v_candidate->>'recommendation_score','')::numeric,0);

      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'offer_id',v_offer.id,
        'supplier_id',v_offer.supplier_id,
        'supplier_name',v_offer.supplier_name,
        'purchase_qty',v_purchase_qty,
        'bonus_units',v_bonus,
        'received_units',v_received,
        'needed_before',v_remaining,
        'cash_cost',v_cash,
        'effective_unit_cost',v_effective,
        'available_quantity',v_offer.available_quantity,
        'availability_unknown',v_available<=0,
        'minimum_order_quantity',v_moq,
        'lead_time_days',coalesce(v_offer.lead_time_days,0),
        'score',round(v_score,1),
        'reason',concat_ws(' • ',
          case when v_line_count=0 then 'أفضل مورد متاح حسب الترتيب النهائي' else 'استكمال الكمية من البديل التالي' end,
          case when v_available>0 and v_available<v_remaining then 'المتاح عند المورد لا يغطي الاحتياج كاملًا' end,
          case when v_moq>v_take then concat('MOQ رفع الكمية المدفوعة إلى ',v_purchase_qty) end,
          case when v_bonus>0 then concat('بونص ',v_bonus,' وحدة') end
        )
      ));

      v_line_count := v_line_count + 1;
      if not (v_offer.supplier_name = any(v_supplier_names)) then
        v_supplier_names := array_append(v_supplier_names,v_offer.supplier_name);
      end if;
      v_total_cash := v_total_cash + v_cash;
      v_total_bonus := v_total_bonus + v_bonus;
      v_total_overbuy := v_total_overbuy + greatest(0,v_received-v_remaining);
      v_remaining := greatest(0,v_remaining-v_received);
    end loop;

    if v_remaining<=0.0001 then v_covered_items:=v_covered_items+1; end if;
    if cardinality(v_supplier_names)>1 then v_split_items:=v_split_items+1; end if;
    v_total_unresolved := v_total_unresolved + v_remaining;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'item_id',v_item->>'item_id',
      'product_code',v_item->>'product_code',
      'product_name',v_item->>'product_name',
      'needed_qty',v_needed,
      'urgent',coalesce((v_item->>'urgent')::boolean,false),
      'status',case when v_line_count=0 then 'no_feasible_offer' when v_remaining>0.0001 then 'partial' when cardinality(v_supplier_names)>1 then 'split' else 'single_supplier' end,
      'supplier_count',cardinality(v_supplier_names),
      'unresolved_qty',round(v_remaining,2),
      'lines',v_lines
    ));
  end loop;

  return jsonb_build_object(
    'ok',true,
    'order',v_decision->'order',
    'summary',jsonb_build_object(
      'items',v_item_count,
      'fully_covered_items',v_covered_items,
      'split_items',v_split_items,
      'unresolved_units',round(v_total_unresolved,2),
      'planned_cash_cost',round(v_total_cash,2),
      'bonus_units',round(v_total_bonus,2),
      'overbuy_units',round(v_total_overbuy,2)
    ),
    'items',v_items,
    'method',jsonb_build_object(
      'type','review_only_heuristic',
      'note','خطة مراجعة فقط ولا تغيّر المورد أو الكميات أو حالة الطلبية.',
      'allocation','يبدأ بأعلى Score نهائي ثم يستخدم المورد التالي فقط عند وجود نقص توافر معروف أو عدم كفاية المورد الأول.',
      'unknown_availability','التوافر غير المحدد يعتبر قابلًا للتغطية ولا يتم اختراع حد كمية.',
      'moq','لا يستخدم عرضًا إذا كان MOQ نفسه أكبر من الكمية المتاحة المعلنة، ويظهر أي زيادة ناتجة عن MOQ أو البونص بوضوح.'
    )
  );
end;
$$;

grant execute on function public.smart_purchase_supplier_allocation_plan_v1(text,uuid) to anon,authenticated;
CREATE OR REPLACE FUNCTION public.smart_purchase_demand_transfer_preview_v3(p_session_token text, p_branch text, p_financial_mode text DEFAULT 'medium'::text, p_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  v_mode text:=lower(coalesce(nullif(trim(p_financial_mode),''),'medium'));
  v_base jsonb;
  v_plan jsonb:='[]'::jsonb;
  v_summary jsonb:='{}'::jsonb;
begin
  if v_mode<>'essential' then
    return public.smart_purchase_demand_transfer_preview_v2(p_session_token,p_branch,v_mode,p_rows);
  end if;

  v_base:=public.smart_purchase_demand_transfer_preview_v2(p_session_token,p_branch,'critical',p_rows);
  if coalesce((v_base->>'ok')::boolean,false)=false then return v_base; end if;

  with rows as (
    select value item
    from jsonb_array_elements(coalesce(v_base->'data'->'plan','[]'::jsonb))
  ),
  classified as (
    select
      item,
      (
        coalesce((item->>'customer_requests_count')::int,0)>0
        or coalesce((item->>'priority_score')::numeric,0)>=50
        or (
          coalesce((item->>'current_stock')::numeric,0)<=0
          and coalesce((item->>'usage_per_day')::numeric,0)>0
        )
        or (
          coalesce(item->>'movement_class','')='fast_mover'
          and coalesce((item->>'coverage_days')::numeric,999)<=7
        )
      ) essential_eligible,
      case
        when coalesce((item->>'customer_requests_count')::int,0)>0 then 'open_customer_request'
        when coalesce((item->>'current_stock')::numeric,0)<=0 and coalesce((item->>'usage_per_day')::numeric,0)>0 then 'zero_stock_with_demand'
        when coalesce((item->>'priority_score')::numeric,0)>=50 then 'high_priority'
        when coalesce(item->>'movement_class','')='fast_mover' and coalesce((item->>'coverage_days')::numeric,999)<=7 then 'fast_mover_low_coverage'
        else 'low_priority_for_essential_mode'
      end essential_reason
    from rows
  ),
  final as (
    select
      case
        when essential_eligible then
          jsonb_set(
            jsonb_set(
              jsonb_set(item,'{financial_mode}','"essential"'::jsonb,true),
              '{target_coverage_days}','7'::jsonb,true
            ),
            '{essential_reason}',to_jsonb(essential_reason),true
          )
        else
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(item,'{financial_mode}','"essential"'::jsonb,true),
                  '{target_coverage_days}','7'::jsonb,true
                ),
                '{decision}','"defer_low_priority"'::jsonb,true
              ),
              '{buy_quantity}','0'::jsonb,true
            ),
            '{buy_estimated_cost}','0'::jsonb,true
          ) || jsonb_build_object(
            'essential_reason',essential_reason,
            'suggested_transfer_qty',0
          )
      end row_json,
      essential_eligible
    from classified
  )
  select
    coalesce(jsonb_agg(row_json),'[]'::jsonb),
    jsonb_build_object(
      'items',count(*),
      'need_items',count(*) filter(where coalesce((row_json->>'gross_need')::numeric,0)>0),
      'essential_items',count(*) filter(where essential_eligible and coalesce((row_json->>'buy_quantity')::numeric,0)>0),
      'deferred_low_priority_items',count(*) filter(where not essential_eligible and coalesce((row_json->>'gross_need')::numeric,0)>0),
      'transfer_only_items',count(*) filter(where row_json->>'decision'='transfer_only'),
      'transfer_then_buy_items',count(*) filter(where row_json->>'decision'='transfer_then_buy'),
      'buy_items',count(*) filter(where row_json->>'decision'='buy'),
      'blocked_deadstock_items',count(*) filter(where row_json->>'decision'='do_not_buy'),
      'suggested_transfer_units',coalesce(sum(coalesce((row_json->>'suggested_transfer_qty')::numeric,0)),0),
      'suggested_buy_units',coalesce(sum(coalesce((row_json->>'buy_quantity')::numeric,0)),0),
      'suggested_buy_value',round(coalesce(sum(coalesce((row_json->>'buy_estimated_cost')::numeric,0)),0)::numeric,2)
    )
  into v_plan,v_summary
  from final;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'branch',p_branch,
      'financial_mode','essential',
      'target_coverage_days',7,
      'summary',v_summary,
      'plan',v_plan,
      'method',jsonb_build_object(
        'base_engine','smart_purchase_demand_transfer_preview_v2 / critical 7 days',
        'essential_gate','طلب عميل مفتوح أو رصيد صفر مع حركة أو priority >= 50 أو سريع الحركة وتغطيته <= 7 أيام',
        'low_priority_rule','أي نقص غير أساسي يؤجل ولا يدخل شراء في وضع الضروريات فقط',
        'transfer_before_buy',true,
        'deadstock_block',true
      )
    )
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.smart_purchase_safe_draft_preview_v3(p_session_token text, p_branch text, p_target_budget numeric DEFAULT NULL::numeric, p_financial_mode text DEFAULT 'medium'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  a record;
  v_guard jsonb;
  v_guard_row jsonb;
  v_intel jsonb;
  v_safe_cap numeric:=0;
  v_branch_min numeric:=0;
  v_branch_max numeric:=0;
  v_budget numeric:=0;
  v_remaining numeric:=0;
  v_total numeric:=0;
  v_plan jsonb:='[]'::jsonb;
  v_item jsonb;
  v_policy record;
  v_raw_qty numeric;
  v_qty numeric;
  v_affordable numeric;
  v_unit_cost numeric;
  v_min numeric;
  v_max numeric;
  v_pack numeric;
  v_line_total numeric;
  v_count int:=0;
  v_conflicts int:=0;
  v_budget_skipped int:=0;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;
  if coalesce(trim(p_branch),'')='' or p_branch='all' then
    return jsonb_build_object('ok',false,'error','branch_required');
  end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  select
    greatest(0,coalesce(bp.minimum_order_value,0)),
    greatest(0,coalesce(bp.maximum_order_value,0))
  into v_branch_min,v_branch_max
  from public.purchase_branch_policies bp
  where bp.branch=p_branch and bp.is_active=true
  order by bp.updated_at desc
  limit 1;

  v_branch_min:=coalesce(v_branch_min,0);
  v_branch_max:=coalesce(v_branch_max,0);

  v_guard:=public.smart_purchase_cycle_budget_guard(p_session_token,p_branch);
  if coalesce(v_guard->>'ok','true')='false' then return v_guard; end if;

  select value into v_guard_row
  from jsonb_array_elements(coalesce(v_guard->'data'->'branches',v_guard->'branches','[]'::jsonb))
  where value->>'branch'=p_branch
  limit 1;

  if v_guard_row is null then return jsonb_build_object('ok',false,'error','branch_budget_not_found'); end if;

  v_safe_cap:=greatest(0,coalesce((v_guard_row->>'safe_order_today')::numeric,0));
  v_budget:=v_safe_cap;
  if p_target_budget is not null and p_target_budget>0 then v_budget:=least(v_budget,p_target_budget); end if;
  if v_branch_max>0 then v_budget:=least(v_budget,v_branch_max); end if;
  v_remaining:=v_budget;

  if v_budget<=0 then
    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'branch',p_branch,'financial_mode',lower(coalesce(p_financial_mode,'medium')),
      'target_coverage_days',case lower(coalesce(p_financial_mode,'medium')) when 'essential' then 7 when 'critical' then 7 when 'comfortable' then 30 else 14 end,
      'safe_cap_today',v_safe_cap,'branch_minimum_order_value',v_branch_min,'branch_maximum_order_value',v_branch_max,
      'planning_budget',0,'estimated_total',0,'remaining_budget',0,'items_count',0,'plan','[]'::jsonb,
      'decision','no_safe_capacity','message','لا توجد مساحة شراء آمنة اليوم بعد احتياطي الدورة والالتزامات الحالية.'
    ));
  end if;

  v_intel:=public.smart_purchase_demand_transfer_preview_v3(p_session_token,p_branch,p_financial_mode,'[]'::jsonb);
  if coalesce(v_intel->>'ok','true')='false' then return v_intel; end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_intel->'data'->'plan','[]'::jsonb))
    where coalesce((value->>'buy_quantity')::numeric,0)>0
      and coalesce((value->>'unit_cost')::numeric,0)>0
      and coalesce(value->>'decision','') not in ('do_not_buy','transfer_only','enough_stock')
    order by
      coalesce((value->>'customer_requests_count')::int,0) desc,
      coalesce((value->>'priority_score')::numeric,0) desc,
      coalesce((value->>'gross_need')::numeric,0) desc
  loop
    exit when v_remaining<=0;

    v_raw_qty:=greatest(0,coalesce((v_item->>'buy_quantity')::numeric,0));
    v_unit_cost:=greatest(0,coalesce((v_item->>'unit_cost')::numeric,0));

    select
      greatest(0,coalesce(pp.minimum_order_quantity,0)),
      greatest(0,coalesce(pp.maximum_order_quantity,0)),
      greatest(0,coalesce(pp.package_multiple,0))
    into v_min,v_max,v_pack
    from public.purchase_product_policies pp
    where pp.branch=p_branch
      and pp.is_active=true
      and (
        (nullif(trim(v_item->>'product_code'),'') is not null and pp.product_code=v_item->>'product_code')
        or pp.product_key=coalesce(nullif(trim(v_item->>'product_code'),''),public.purchase_normalize_product_name(v_item->>'product_name'))
        or public.purchase_normalize_product_name(pp.product_name)=public.purchase_normalize_product_name(v_item->>'product_name')
      )
    order by
      case when nullif(trim(v_item->>'product_code'),'') is not null and pp.product_code=v_item->>'product_code' then 0 else 1 end,
      pp.updated_at desc
    limit 1;

    v_min:=coalesce(v_min,0);
    v_max:=coalesce(v_max,0);
    v_pack:=coalesce(v_pack,0);

    if v_min>0 and v_max>0 and v_min>v_max then
      v_conflicts:=v_conflicts+1;
      continue;
    end if;

    v_qty:=greatest(v_raw_qty,case when v_raw_qty>0 then v_min else 0 end);

    if v_pack>1 and v_qty>0 then
      v_qty:=ceil(round((v_qty/v_pack)::numeric,8))*v_pack;
    else
      v_qty:=ceil(round(v_qty::numeric,8));
    end if;

    if v_max>0 and v_qty>v_max then
      if v_pack>1 then v_qty:=floor(v_max/v_pack)*v_pack;
      else v_qty:=floor(v_max); end if;
    end if;

    if v_qty<=0 or (v_min>0 and v_qty<v_min) then
      v_conflicts:=v_conflicts+1;
      continue;
    end if;

    v_affordable:=floor(v_remaining/v_unit_cost);
    if v_pack>1 then v_affordable:=floor(v_affordable/v_pack)*v_pack; end if;
    v_qty:=least(v_qty,v_affordable);

    if v_qty<=0 or (v_min>0 and v_qty<v_min) then
      v_budget_skipped:=v_budget_skipped+1;
      continue;
    end if;

    v_line_total:=round((v_qty*v_unit_cost)::numeric,2);

    v_plan:=v_plan||jsonb_build_array(jsonb_build_object(
      'product_code',v_item->>'product_code',
      'product_name',v_item->>'product_name',
      'financial_mode',v_item->>'financial_mode',
      'target_coverage_days',v_item->'target_coverage_days',
      'movement_class',v_item->>'movement_class',
      'current_stock',v_item->'current_stock',
      'pending_incoming',v_item->'pending_incoming',
      'usage_per_day',v_item->'usage_per_day',
      'coverage_days',v_item->'coverage_days',
      'gross_need_before_transfer',v_item->'gross_need',
      'transfer_from_branch',v_item->>'transfer_from_branch',
      'suggested_transfer_quantity',v_item->'suggested_transfer_qty',
      'buy_quantity_before_policy',v_raw_qty,
      'proposed_quantity',v_qty,
      'unit_cost',v_unit_cost,
      'estimated_total',v_line_total,
      'minimum_order_quantity',v_min,
      'maximum_order_quantity',v_max,
      'package_multiple',v_pack,
      'customer_requests_count',coalesce((v_item->>'customer_requests_count')::int,0),
      'priority_score',coalesce((v_item->>'priority_score')::numeric,0),
      'decision',v_item->>'decision',
      'reason',case
        when coalesce((v_item->>'suggested_transfer_qty')::numeric,0)>0
          then 'تم خصم التحويل الداخلي أولًا ثم تطبيق حدود الصنف والميزانية'
        else 'احتياج بعد التغطية المطلوبة ثم تطبيق حدود الصنف والميزانية'
      end
    ));

    v_total:=v_total+v_line_total;
    v_remaining:=greatest(0,v_remaining-v_line_total);
    v_count:=v_count+1;
    v_min:=0; v_max:=0; v_pack:=0;
  end loop;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'branch',p_branch,
    'financial_mode',lower(coalesce(p_financial_mode,'medium')),
    'target_coverage_days',coalesce(v_intel->'data'->'target_coverage_days','14'::jsonb),
    'safe_cap_today',round(v_safe_cap,2),
    'requested_budget',coalesce(p_target_budget,0),
    'branch_minimum_order_value',v_branch_min,
    'branch_maximum_order_value',v_branch_max,
    'planning_budget',round(v_budget,2),
    'estimated_total',round(v_total,2),
    'remaining_budget',round(v_remaining,2),
    'items_count',v_count,
    'policy_conflicts',v_conflicts,
    'budget_skipped_items',v_budget_skipped,
    'transfer_summary',v_intel->'data'->'summary',
    'plan',v_plan,
    'decision',case
      when v_count=0 then 'no_eligible_items'
      when v_branch_min>0 and v_total<v_branch_min-0.01 then 'below_branch_minimum'
      else 'ready_for_review'
    end,
    'message',case
      when v_count=0 then 'لا توجد أصناف شراء مؤهلة بعد التحويل الداخلي وحدود الأصناف والميزانية.'
      when v_branch_min>0 and v_total<v_branch_min-0.01 then 'قيمة المسودة أقل من الحد الأدنى التشغيلي المحفوظ للفرع.'
      else 'المسودة موحدة مع عقل الطلبية: تغطية حسب الوضع المالي، تحويل قبل الشراء، ثم حدود الصنف والميزانية.'
    end,
    'method',jsonb_build_object(
      'demand_engine','smart_purchase_demand_transfer_preview_v3',
      'financial_modes','essential=7+priority gate, critical=7, medium=14, comfortable=30',
      'transfer_before_buy',true,
      'deadstock_block',true,
      'item_policy_order','minimum -> package multiple -> maximum -> affordable package quantity',
      'budget_rule','الأقل من سقف السيولة الآمن والميزانية المطلوبة والحد الأقصى المحفوظ للفرع'
    )
  ));
end $function$
;

CREATE OR REPLACE FUNCTION public.smart_purchase_safe_draft_create_v3(p_session_token text, p_branch text, p_target_budget numeric DEFAULT NULL::numeric, p_financial_mode text DEFAULT 'medium'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  a record;
  v_mode text:=lower(coalesce(nullif(trim(p_financial_mode),''),'medium'));
  v_preview jsonb;
  v_data jsonb;
  v_order_id uuid;
  v_order_number text;
  v_title text;
  v_item jsonb;
  v_analysis_id uuid;
  v_total numeric;
  v_items int;
begin
  if v_mode<>'essential' then
    return public.smart_purchase_safe_draft_create_v2(p_session_token,p_branch,p_target_budget,v_mode);
  end if;

  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  perform pg_advisory_xact_lock(hashtext('purchase-planning:'||p_branch));

  if public.smart_purchase_branch_has_planning_order_v2(p_branch) then
    return jsonb_build_object('ok',false,'error','open_order_exists');
  end if;

  v_preview:=public.smart_purchase_safe_draft_preview_v3(p_session_token,p_branch,p_target_budget,'essential');
  if coalesce((v_preview->>'ok')::boolean,false)=false then return v_preview; end if;

  v_data:=v_preview->'data';
  v_items:=coalesce((v_data->>'items_count')::int,0);
  v_total:=coalesce((v_data->>'estimated_total')::numeric,0);

  if v_items<=0 or v_total<=0 then
    return jsonb_build_object('ok',false,'error','empty_safe_draft','preview',v_data);
  end if;
  if coalesce(v_data->>'decision','')='below_branch_minimum' then
    return jsonb_build_object('ok',false,'error','order_below_minimum','preview',v_data);
  end if;

  v_order_id:=gen_random_uuid();
  v_order_number:='PO-AUTO-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(v_order_id::text,'-',''),1,4));
  v_title:='مسودة ذكية - الضروريات فقط - '||p_branch||' - '||to_char(current_date,'YYYY-MM-DD');

  insert into public.smart_purchase_orders(
    id,order_number,branch,title,status,budget,expected_total,approved_total,
    minimum_order_value,maximum_order_value,
    created_by_account_id,created_by_name,created_at,updated_at
  )
  values(
    v_order_id,v_order_number,p_branch,v_title,'مسودة',
    coalesce((v_data->>'planning_budget')::numeric,v_total),v_total,v_total,
    coalesce((v_data->>'branch_minimum_order_value')::numeric,0),
    coalesce((v_data->>'branch_maximum_order_value')::numeric,0),
    a.id,a.display_name,now(),now()
  );

  for v_item in
    select value from jsonb_array_elements(coalesce(v_data->'plan','[]'::jsonb))
  loop
    select pai.id into v_analysis_id
    from public.purchase_analysis_items pai
    where pai.branch=p_branch
      and (
        (nullif(trim(v_item->>'product_code'),'') is not null and pai.product_code=v_item->>'product_code')
        or public.purchase_normalize_product_name(pai.product_name)=public.purchase_normalize_product_name(v_item->>'product_name')
      )
    order by
      case when nullif(trim(v_item->>'product_code'),'') is not null and pai.product_code=v_item->>'product_code' then 0 else 1 end,
      pai.created_at desc
    limit 1;

    insert into public.smart_purchase_order_items(
      order_id,analysis_item_id,product_code,product_name,supplier_name,
      requested_quantity,approved_quantity,expected_unit_cost,expected_total,
      customer_requests_count,priority_score,status,notes,supplier_reason,manual_override,
      minimum_order_quantity,maximum_order_quantity,package_multiple,
      created_at,updated_at
    )
    values(
      v_order_id,v_analysis_id,nullif(trim(v_item->>'product_code'),''),v_item->>'product_name',null,
      coalesce((v_item->>'proposed_quantity')::numeric,0),
      coalesce((v_item->>'proposed_quantity')::numeric,0),
      coalesce((v_item->>'unit_cost')::numeric,0),
      coalesce((v_item->>'estimated_total')::numeric,0),
      coalesce((v_item->>'customer_requests_count')::int,0),
      coalesce((v_item->>'priority_score')::numeric,0),
      'pending',
      'وضع الضروريات فقط: 7 أيام + فلتر أولوية مشدد'
        ||case when coalesce((v_item->>'suggested_transfer_quantity')::numeric,0)>0
          then ' • تحويل مقترح '||coalesce(v_item->>'suggested_transfer_quantity','0')||' من '||coalesce(v_item->>'transfer_from_branch','الفرع الآخر')
          else '' end,
      'المورد غير معتمد بعد — راجع عروض الموردين قبل اعتماد الطلبية',
      false,
      coalesce((v_item->>'minimum_order_quantity')::numeric,0),
      coalesce((v_item->>'maximum_order_quantity')::numeric,0),
      coalesce((v_item->>'package_multiple')::numeric,0),
      now(),now()
    );

    v_analysis_id:=null;
  end loop;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'id',v_order_id,'order_number',v_order_number,'title',v_title,'branch',p_branch,'status','مسودة',
    'financial_mode','essential','target_coverage_days',7,
    'budget',coalesce((v_data->>'planning_budget')::numeric,v_total),
    'estimated_total',v_total,'items_count',v_items,
    'transfer_summary',v_data->'transfer_summary',
    'message','تم إنشاء مسودة الضروريات فقط. لم يتم اعتمادها أو إرسالها لأي مورد.'
  ));
exception when others then
  if v_order_id is not null then delete from public.smart_purchase_orders where id=v_order_id; end if;
  raise;
end $function$
;

revoke all on function public.smart_purchase_demand_transfer_preview_v3(text,text,text,jsonb) from public;
revoke all on function public.smart_purchase_safe_draft_preview_v3(text,text,numeric,text) from public;
revoke all on function public.smart_purchase_safe_draft_create_v3(text,text,numeric,text) from public;
grant execute on function public.smart_purchase_demand_transfer_preview_v3(text,text,text,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_safe_draft_preview_v3(text,text,numeric,text) to anon,authenticated;
grant execute on function public.smart_purchase_safe_draft_create_v3(text,text,numeric,text) to anon,authenticated;

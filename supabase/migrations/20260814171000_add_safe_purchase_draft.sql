create or replace function public.smart_purchase_safe_draft_preview_v1(
  p_session_token text,
  p_branch text,
  p_target_budget numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare
  a record;
  v_guard jsonb;
  v_inventory jsonb;
  v_guard_row jsonb;
  v_safe_cap numeric := 0;
  v_budget numeric := 0;
  v_remaining numeric := 0;
  v_total numeric := 0;
  v_plan jsonb := '[]'::jsonb;
  v_row record;
  v_item jsonb;
  v_unit_cost numeric;
  v_need_qty numeric;
  v_qty numeric;
  v_line_total numeric;
  v_usage numeric;
  v_stock numeric;
  v_pending numeric;
  v_coverage numeric;
  v_stored_requests int;
  v_live_requests int;
  v_effective_requests int;
  v_score numeric;
  v_reason text;
  v_count int := 0;
begin
  perform set_config('statement_timeout','25000',true);

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
  if a.role='branch_manager' and not (
    coalesce(a.branch_ids,'[]'::jsonb) ? p_branch
    or coalesce(a.branch_ids,'[]'::jsonb) ? replace(p_branch,'دواء ','')
    or coalesce(a.branch_ids,'[]'::jsonb) ? replace(p_branch,'فرع ','')
  ) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  v_guard := public.smart_purchase_cycle_budget_guard(p_session_token,p_branch);
  v_inventory := public.smart_purchase_inventory_command_center_v3(p_session_token,p_branch);
  if coalesce(v_guard->>'ok','true')='false' then return v_guard; end if;
  if coalesce(v_inventory->>'ok','true')='false' then return v_inventory; end if;

  select value into v_guard_row
  from jsonb_array_elements(coalesce(v_guard->'branches','[]'::jsonb))
  where value->>'branch'=p_branch
  limit 1;

  if v_guard_row is null then
    return jsonb_build_object('ok',false,'error','branch_budget_not_found');
  end if;

  v_safe_cap := greatest(0,coalesce((v_guard_row->>'safe_order_today')::numeric,0));
  v_budget := case
    when p_target_budget is not null and p_target_budget>0 then least(v_safe_cap,p_target_budget)
    else v_safe_cap
  end;
  v_remaining := v_budget;

  if v_budget<=0 then
    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'branch',p_branch,'safe_cap_today',v_safe_cap,'requested_budget',coalesce(p_target_budget,0),
      'planning_budget',0,'estimated_total',0,'remaining_budget',0,'items_count',0,'plan','[]'::jsonb,
      'decision','no_safe_capacity','message','لا توجد مساحة شراء آمنة اليوم بعد احتياطي الدورة والالتزامات الحالية.'
    ));
  end if;

  for v_row in
    select x.value as item,
      coalesce((
        select count(*)::int
        from public.customer_orders co
        where public.purchase_normalize_product_name(co.product_name)=public.purchase_normalize_product_name(x.value->>'product_name')
          and (
            coalesce(trim(co.branch),'')=p_branch
            or replace(coalesce(trim(co.branch),''),'دواء ','')=replace(p_branch,'دواء ','')
            or replace(coalesce(trim(co.branch),''),'فرع ','')=replace(p_branch,'فرع ','')
          )
          and lower(coalesce(co.status,'')) not in ('cancelled','completed','delivered','closed')
          and coalesce(co.status,'') not in ('تم التوصيل','تم الإلغاء','تم','ملغي')
      ),0) as live_requests
    from jsonb_array_elements(coalesce(v_inventory->'stock_needed','[]'::jsonb)) x
    where x.value->>'branch'=p_branch
    order by (
      coalesce((x.value->>'priority_score')::numeric,0)
      + greatest(coalesce((x.value->>'customer_requests_count')::int,0),coalesce((
          select count(*)::int from public.customer_orders co2
          where public.purchase_normalize_product_name(co2.product_name)=public.purchase_normalize_product_name(x.value->>'product_name')
            and (coalesce(trim(co2.branch),'')=p_branch or replace(coalesce(trim(co2.branch),''),'دواء ','')=replace(p_branch,'دواء ',''))
            and lower(coalesce(co2.status,'')) not in ('cancelled','completed','delivered','closed')
            and coalesce(co2.status,'') not in ('تم التوصيل','تم الإلغاء','تم','ملغي')
        ),0))*40
      + least(60,coalesce((x.value->>'usage_per_day')::numeric,0)*12)
      + case when coalesce((x.value->>'current_stock')::numeric,0)<=0 and coalesce((x.value->>'usage_per_day')::numeric,0)>0 then 35 else 0 end
    ) desc,
    coalesce((x.value->>'month_need_cost')::numeric,0) asc
  loop
    exit when v_remaining<=0;
    v_item := v_row.item;
    v_unit_cost := greatest(0,coalesce((v_item->>'unit_cost')::numeric,0));
    v_need_qty := greatest(0,ceil(coalesce((v_item->>'month_need_qty')::numeric,0)));
    if v_unit_cost<=0 or v_need_qty<=0 or v_remaining<v_unit_cost then continue; end if;

    v_usage := greatest(0,coalesce((v_item->>'usage_per_day')::numeric,0));
    v_stock := greatest(0,coalesce((v_item->>'current_stock')::numeric,0));
    v_pending := greatest(0,coalesce((v_item->>'pending_incoming')::numeric,0));
    v_coverage := coalesce((v_item->>'coverage_days')::numeric,999);
    v_stored_requests := greatest(0,coalesce((v_item->>'customer_requests_count')::int,0));
    v_live_requests := greatest(0,coalesce(v_row.live_requests,0));
    v_effective_requests := greatest(v_stored_requests,v_live_requests);
    v_score := greatest(0,coalesce((v_item->>'priority_score')::numeric,0))
      + v_effective_requests*40
      + least(60,v_usage*12)
      + case when v_stock<=0 and v_usage>0 then 35 else 0 end;

    v_qty := least(v_need_qty,floor(v_remaining/v_unit_cost));
    if v_qty<=0 then continue; end if;
    v_line_total := round((v_qty*v_unit_cost)::numeric,2);

    v_reason := case
      when v_effective_requests>0 then 'طلبات عملاء مفتوحة + احتياج استوك'
      when v_stock<=0 and v_usage>0 then 'رصيد صفر مع حركة فعلية'
      when v_coverage<=7 then 'تغطية أقل من أسبوع'
      when v_coverage<=14 then 'تغطية منخفضة وحركة مستمرة'
      when v_usage>=1 then 'عالية الحركة وتحتاج تغطية'
      else 'احتياج محسوب بعد الرصيد والمنتظر ومخزون الأمان'
    end;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'product_code',v_item->>'product_code','product_name',v_item->>'product_name',
      'current_stock',v_stock,'pending_incoming',v_pending,'coverage_days',case when v_coverage=999 then null else v_coverage end,
      'usage_per_day',round(v_usage,3),'month_need_qty',v_need_qty,'proposed_quantity',v_qty,
      'unit_cost',v_unit_cost,'estimated_total',v_line_total,
      'stored_customer_requests',v_stored_requests,'live_customer_requests',v_live_requests,
      'effective_customer_requests',v_effective_requests,'priority_score',round(v_score,1),
      'preferred_supplier',v_item->>'preferred_supplier','reason',v_reason
    ));
    v_total := v_total+v_line_total;
    v_remaining := greatest(0,v_remaining-v_line_total);
    v_count := v_count+1;
  end loop;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'branch',p_branch,'safe_cap_today',round(v_safe_cap,2),'requested_budget',coalesce(p_target_budget,0),
    'planning_budget',round(v_budget,2),'estimated_total',round(v_total,2),'remaining_budget',round(v_remaining,2),
    'items_count',v_count,'plan',v_plan,
    'decision',case when v_count>0 then 'ready_for_review' else 'no_eligible_items' end,
    'message',case when v_count>0 then 'المسودة مبنية على الحد الآمن اليوم واحتياج المخزون، وتحتاج مراجعة قبل الاعتماد.' else 'لا توجد أصناف مؤهلة داخل الميزانية الآمنة الحالية.' end,
    'method',jsonb_build_object(
      'budget_rule','الأقل من القيمة المطلوبة وأقصى شراء مقترح اليوم',
      'quantity_rule','تغطية 30 يوم + مخزون أمان - الرصيد - المنتظر، مع تخصيص الكمية حسب أولوية الطلب والميزانية',
      'customer_rule','طلبات العملاء المفتوحة ترفع الأولوية ولا تسمح بتجاهل الصنف بسبب ترتيب مالي فقط',
      'supplier_rule','المسودة لا تعتمد المورد تلقائيًا؛ اختيار المورد يظل ضمن مرحلة مراجعة الطلبية'
    )
  ));
end;
$$;

grant execute on function public.smart_purchase_safe_draft_preview_v1(text,text,numeric) to anon,authenticated;

create or replace function public.smart_purchase_safe_draft_create_v1(
  p_session_token text,
  p_branch text,
  p_target_budget numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare
  a record;
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
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  v_preview := public.smart_purchase_safe_draft_preview_v1(p_session_token,p_branch,p_target_budget);
  if coalesce(v_preview->>'ok','true')='false' then return v_preview; end if;
  v_data := v_preview->'data';
  v_items := coalesce((v_data->>'items_count')::int,0);
  v_total := coalesce((v_data->>'estimated_total')::numeric,0);
  if v_items<=0 or v_total<=0 then return jsonb_build_object('ok',false,'error','empty_safe_draft','preview',v_data); end if;

  v_order_id := gen_random_uuid();
  v_order_number := 'PO-AUTO-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(v_order_id::text,'-',''),1,4));
  v_title := 'مسودة آمنة تلقائية - '||p_branch||' - '||to_char(current_date,'YYYY-MM-DD');

  insert into public.smart_purchase_orders(
    id,order_number,branch,title,status,budget,expected_total,approved_total,created_by_account_id,created_by_name,created_at,updated_at
  ) values (
    v_order_id,v_order_number,p_branch,v_title,'مسودة',coalesce((v_data->>'planning_budget')::numeric,v_total),v_total,v_total,a.id,a.display_name,now(),now()
  );

  for v_item in select value from jsonb_array_elements(coalesce(v_data->'plan','[]'::jsonb)) loop
    select pai.id into v_analysis_id
    from public.purchase_analysis_items pai
    where pai.branch=p_branch
      and (
        (nullif(trim(v_item->>'product_code'),'') is not null and pai.product_code=v_item->>'product_code')
        or public.purchase_normalize_product_name(pai.product_name)=public.purchase_normalize_product_name(v_item->>'product_name')
      )
    order by case when nullif(trim(v_item->>'product_code'),'') is not null and pai.product_code=v_item->>'product_code' then 0 else 1 end,
      pai.created_at desc limit 1;

    insert into public.smart_purchase_order_items(
      order_id,analysis_item_id,product_code,product_name,supplier_name,requested_quantity,approved_quantity,
      expected_unit_cost,expected_total,customer_requests_count,priority_score,status,notes,supplier_reason,manual_override,created_at,updated_at
    ) values (
      v_order_id,v_analysis_id,nullif(trim(v_item->>'product_code'),''),v_item->>'product_name',null,
      coalesce((v_item->>'proposed_quantity')::numeric,0),coalesce((v_item->>'proposed_quantity')::numeric,0),
      coalesce((v_item->>'unit_cost')::numeric,0),coalesce((v_item->>'estimated_total')::numeric,0),
      coalesce((v_item->>'effective_customer_requests')::int,0),coalesce((v_item->>'priority_score')::numeric,0),'pending',
      'تم إنشاؤه من المسودة الآمنة: '||coalesce(v_item->>'reason','احتياج استوك'),
      'المورد غير معتمد بعد — راجع عروض الموردين قبل اعتماد الطلبية',false,now(),now()
    );
    v_analysis_id := null;
  end loop;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'id',v_order_id,'order_number',v_order_number,'title',v_title,'branch',p_branch,'status','مسودة',
    'budget',coalesce((v_data->>'planning_budget')::numeric,v_total),'estimated_total',v_total,'items_count',v_items,
    'message','تم إنشاء مسودة فقط. لم يتم اعتمادها أو حجز سيولة أو إرسالها لأي مورد.'
  ));
exception when others then
  if v_order_id is not null then delete from public.smart_purchase_orders where id=v_order_id; end if;
  raise;
end;
$$;

grant execute on function public.smart_purchase_safe_draft_create_v1(text,text,numeric) to anon,authenticated;

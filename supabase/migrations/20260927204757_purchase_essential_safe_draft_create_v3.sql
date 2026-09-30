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

revoke all on function public.smart_purchase_safe_draft_create_v3(text,text,numeric,text) from public;
grant execute on function public.smart_purchase_safe_draft_create_v3(text,text,numeric,text) to anon,authenticated;

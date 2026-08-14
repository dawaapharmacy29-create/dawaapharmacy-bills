create or replace function public.smart_purchase_save_workflow_snapshot(p_session_token text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp','extensions'
as $function$
declare
  v_auth jsonb;
  v_id uuid;
  v_order_id uuid;
  v_workflow_type text;
  v_branch text;
  v_detail jsonb;
  v_product_name text;
  v_product_code text;
  v_received numeric;
  v_alerts jsonb := '[]'::jsonb;
  v_alert_count integer := 0;
begin
  if coalesce(trim(p_session_token),'')='' then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select public.smart_purchase_unified(p_session_token,'dashboard','{}'::jsonb) into v_auth;
  if coalesce((v_auth->>'ok')::boolean,false) is not true then
    return jsonb_build_object('ok',false,'error',coalesce(v_auth->>'error','invalid_session'),'message',coalesce(v_auth->>'message','تعذر التحقق من الجلسة.'));
  end if;

  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  v_workflow_type:=nullif(trim(p_payload->>'workflow_type'),'');
  if v_order_id is null then return jsonb_build_object('ok',false,'error','invalid_order'); end if;
  if v_workflow_type not in ('supplier_response','receipt') then return jsonb_build_object('ok',false,'error','invalid_workflow_type'); end if;
  select branch into v_branch from public.smart_purchase_orders where id=v_order_id;

  insert into public.smart_purchase_workflow_snapshots(order_id,workflow_type,response_type,supplier_name,file_name,summary,details)
  values(v_order_id,v_workflow_type,nullif(trim(p_payload->>'response_type'),''),nullif(trim(p_payload->>'supplier_name'),''),nullif(trim(p_payload->>'file_name'),''),coalesce(p_payload->'summary','{}'::jsonb),coalesce(p_payload->'details','{}'::jsonb))
  returning id into v_id;

  if v_workflow_type='receipt' then
    for v_detail in select value from jsonb_array_elements(coalesce(p_payload->'details'->'details','[]'::jsonb)) loop
      v_received:=greatest(0,coalesce(nullif(v_detail->>'received','')::numeric,0));
      if v_received<=0 then continue; end if;
      v_product_name:=coalesce(nullif(trim(v_detail->'item'->>'product_name'),''),nullif(trim(v_detail->'row'->>'product_name'),''));
      v_product_code:=coalesce(nullif(trim(v_detail->'item'->>'product_code'),''),nullif(trim(v_detail->'row'->>'product_code'),''));
      if v_product_name is null then continue; end if;

      insert into public.purchase_arrival_alerts(purchase_order_id,workflow_snapshot_id,customer_order_id,alert_type,product_code,product_name,received_quantity,branch,message,target_path)
      select v_order_id,v_id,co.id,
        case when co.status='النواقص' then 'shortage_available' else 'customer_request_available' end,
        v_product_code,v_product_name,v_received,v_branch,
        case when co.status='النواقص'
          then 'الصنف '||v_product_name||' وصل للفرع وكان مسجلًا في النواقص للعميل '||coalesce(co.customer_name,'')
          else 'الصنف '||v_product_name||' وصل للفرع ويوجد طلب عميل مفتوح باسم '||coalesce(co.customer_name,'') end,
        '/customer-orders?order='||co.id
      from public.customer_orders co
      where coalesce(co.status,'طلب جديد') not in ('تم التوصيل','تم الإلغاء','cancelled','تم توفير الصنف')
        and public.purchase_normalize_product_name(co.product_name)=public.purchase_normalize_product_name(v_product_name)
        and (v_branch is null or co.branch is null or co.branch=v_branch or replace(co.branch,'فرع ','')=replace(v_branch,'دواء ',''))
      on conflict(workflow_snapshot_id,customer_order_id,product_name) do nothing;
    end loop;

    update public.customer_orders co
    set status='تم توفير الصنف',
        product_available=true,
        arrival_notes=concat_ws(E'\n',nullif(co.arrival_notes,''),'تم رصد وصول الصنف تلقائيًا من ملف الاستلام الفعلي للمشتريات.'),
        timeline=coalesce(co.timeline,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'action','arrival_detected_from_purchase_receipt','label','تم توفير الصنف من استلام المشتريات','at',now(),'purchase_order_id',v_order_id,'workflow_snapshot_id',v_id
        )),
        updated_at=now()
    where co.id in (select a.customer_order_id from public.purchase_arrival_alerts a where a.workflow_snapshot_id=v_id);

    select count(*) into v_alert_count from public.purchase_arrival_alerts where workflow_snapshot_id=v_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'customer_order_id',a.customer_order_id,'alert_type',a.alert_type,'product_code',a.product_code,
      'product_name',a.product_name,'received_quantity',a.received_quantity,'branch',a.branch,'message',a.message,'target_path',a.target_path
    ) order by a.created_at desc),'[]'::jsonb) into v_alerts
    from public.purchase_arrival_alerts a where a.workflow_snapshot_id=v_id;
  end if;

  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',v_id,'order_id',v_order_id,'arrival_alerts_count',v_alert_count,'arrival_alerts',v_alerts));
exception when others then
  return jsonb_build_object('ok',false,'error','save_failed','message',sqlerrm);
end;
$function$;

grant execute on function public.smart_purchase_save_workflow_snapshot(text,jsonb) to anon,authenticated;

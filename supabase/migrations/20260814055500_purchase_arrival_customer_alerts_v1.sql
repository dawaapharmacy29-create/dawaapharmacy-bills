create table if not exists public.purchase_arrival_alerts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.smart_purchase_orders(id) on delete cascade,
  workflow_snapshot_id uuid references public.smart_purchase_workflow_snapshots(id) on delete set null,
  customer_order_id text not null references public.customer_orders(id) on delete cascade,
  alert_type text not null check (alert_type in ('customer_request_available','shortage_available')),
  product_code text,
  product_name text not null,
  received_quantity numeric not null default 0,
  branch text,
  message text not null,
  target_path text not null,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(workflow_snapshot_id,customer_order_id,product_name)
);
create index if not exists purchase_arrival_alerts_unread_idx on public.purchase_arrival_alerts(is_read,created_at desc);
create index if not exists purchase_arrival_alerts_customer_order_idx on public.purchase_arrival_alerts(customer_order_id,created_at desc);

create or replace function public.purchase_normalize_product_name(p_value text)
returns text
language sql
immutable
as $$
 select nullif(trim(regexp_replace(
   replace(replace(replace(replace(replace(lower(coalesce(p_value,'')),'أ','ا'),'إ','ا'),'آ','ا'),'ة','ه'),'ى','ي'),
   '[^a-z0-9\u0600-\u06ff]+',' ','g'
 )), '');
$$;

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
          then 'الصنف '||v_product_name||' وصل للفرع ويوجد في النواقص للعميل '||coalesce(co.customer_name,'')
          else 'الصنف '||v_product_name||' وصل للفرع ويوجد طلب عميل مفتوح باسم '||coalesce(co.customer_name,'') end,
        '/customer-orders?order='||co.id
      from public.customer_orders co
      where coalesce(co.status,'طلب جديد') not in ('تم التوصيل','تم الإلغاء','cancelled','تم توفير الصنف')
        and public.purchase_normalize_product_name(co.product_name)=public.purchase_normalize_product_name(v_product_name)
        and (v_branch is null or co.branch is null or co.branch=v_branch or replace(co.branch,'فرع ','')=replace(v_branch,'دواء ',''))
      on conflict(workflow_snapshot_id,customer_order_id,product_name) do nothing;
    end loop;

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

create or replace function public.purchase_arrival_alerts_list(p_session_token text,p_only_unread boolean default true,p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_auth jsonb; v_rows jsonb;
begin
  select public.smart_purchase_unified(p_session_token,'dashboard','{}'::jsonb) into v_auth;
  if coalesce((v_auth->>'ok')::boolean,false) is not true then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_rows
  from (select * from public.purchase_arrival_alerts where (not p_only_unread or is_read=false) order by created_at desc limit least(greatest(coalesce(p_limit,100),1),500)) x;
  return jsonb_build_object('ok',true,'data',v_rows);
end;
$function$;

create or replace function public.purchase_arrival_alert_mark_read(p_session_token text,p_alert_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_auth jsonb;
begin
  select public.smart_purchase_unified(p_session_token,'dashboard','{}'::jsonb) into v_auth;
  if coalesce((v_auth->>'ok')::boolean,false) is not true then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  update public.purchase_arrival_alerts set is_read=true,read_at=now() where id=p_alert_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('updated',found));
end;
$function$;

grant execute on function public.smart_purchase_save_workflow_snapshot(text,jsonb) to anon,authenticated;
grant execute on function public.purchase_arrival_alerts_list(text,boolean,integer) to anon,authenticated;
grant execute on function public.purchase_arrival_alert_mark_read(text,uuid) to anon,authenticated;

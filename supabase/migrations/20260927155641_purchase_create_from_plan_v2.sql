-- Create a purchase order atomically from the final reviewed plan.
create or replace function public.smart_purchase_create_order_from_plan_v2(
  p_session_token text,
  p_import_id uuid,
  p_branch text,
  p_title text,
  p_budget numeric default 0,
  p_minimum_order_value numeric default 0,
  p_maximum_order_value numeric default 0,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  a record;
  v_order uuid;
  v_import_branch text;
  v_min numeric:=greatest(0,coalesce(p_minimum_order_value,0));
  v_max numeric:=greatest(0,coalesce(p_maximum_order_value,0));
  v_total numeric:=0;
  v_count integer:=0;
  x jsonb;
  v_qty numeric;
  v_cost numeric;
  v_item_min numeric;
  v_item_max numeric;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  if nullif(trim(coalesce(p_branch,'')),'') is null or p_import_id is null then return jsonb_build_object('ok',false,'error','invalid_create_payload'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then return jsonb_build_object('ok',false,'error','empty_plan'); end if;
  if v_min>0 and v_max>0 and v_min>v_max then return jsonb_build_object('ok',false,'error','order_min_exceeds_max'); end if;

  perform pg_advisory_xact_lock(hashtext('purchase-planning:'||trim(p_branch)));

  select branch into v_import_branch from public.purchase_analysis_imports where id=p_import_id;
  if not found then return jsonb_build_object('ok',false,'error','import_not_found'); end if;
  if trim(coalesce(v_import_branch,''))<>trim(p_branch) then return jsonb_build_object('ok',false,'error','import_branch_mismatch'); end if;
  if public.smart_purchase_branch_has_planning_order_v2(p_branch) then return jsonb_build_object('ok',false,'error','open_order_exists'); end if;

  for x in select value from jsonb_array_elements(p_items) loop
    if nullif(trim(coalesce(x->>'product_name','')),'') is null then return jsonb_build_object('ok',false,'error','invalid_item_name'); end if;
    v_qty:=greatest(0,coalesce(nullif(x->>'approved_quantity','')::numeric,0));
    v_cost:=greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0));
    v_item_min:=greatest(0,coalesce(nullif(x->>'minimum_order_quantity','')::numeric,0));
    v_item_max:=greatest(0,coalesce(nullif(x->>'maximum_order_quantity','')::numeric,0));
    if v_item_min>0 and v_item_max>0 and v_item_min>v_item_max then return jsonb_build_object('ok',false,'error','item_min_exceeds_max','product_name',x->>'product_name'); end if;
    if v_qty>0 and v_item_min>0 and v_qty<v_item_min then return jsonb_build_object('ok',false,'error','item_limits_violation','product_name',x->>'product_name'); end if;
    if v_qty>0 and v_item_max>0 and v_qty>v_item_max then return jsonb_build_object('ok',false,'error','item_limits_violation','product_name',x->>'product_name'); end if;
    if v_qty>0 then v_total:=v_total+(v_qty*v_cost); v_count:=v_count+1; end if;
  end loop;

  if v_count=0 then return jsonb_build_object('ok',false,'error','empty_plan'); end if;
  if v_min>0 and v_total<v_min then return jsonb_build_object('ok',false,'error','order_below_minimum','total',v_total,'minimum',v_min); end if;
  if v_max>0 and v_total>v_max then return jsonb_build_object('ok',false,'error','order_above_maximum','total',v_total,'maximum',v_max); end if;

  insert into public.smart_purchase_orders(
    order_number,branch,title,budget,minimum_order_value,maximum_order_value,
    source_import_id,expected_total,approved_total,created_by_account_id,created_by_name
  ) values(
    'PO-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISSMS'),
    trim(p_branch),coalesce(nullif(trim(p_title),''),'طلبية مشتريات ذكية'),
    case when coalesce(p_budget,0)>0 then p_budget else null end,
    v_min,v_max,p_import_id,v_total,v_total,a.id,a.display_name
  ) returning id into v_order;

  insert into public.smart_purchase_order_items(
    order_id,analysis_item_id,product_code,product_name,supplier_name,
    requested_quantity,approved_quantity,expected_unit_cost,expected_discount,expected_total,
    customer_requests_count,priority_score,minimum_order_quantity,maximum_order_quantity
  )
  select
    v_order,nullif(x->>'analysis_item_id','')::uuid,nullif(trim(x->>'product_code'),''),
    trim(x->>'product_name'),nullif(trim(x->>'supplier_name'),''),
    greatest(0,coalesce(nullif(x->>'requested_quantity','')::numeric,nullif(x->>'approved_quantity','')::numeric,0)),
    greatest(0,coalesce(nullif(x->>'approved_quantity','')::numeric,0)),
    greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0)),
    greatest(0,least(100,coalesce(nullif(x->>'expected_discount','')::numeric,0))),
    greatest(0,coalesce(nullif(x->>'approved_quantity','')::numeric,0))*greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0)),
    greatest(0,coalesce(nullif(x->>'customer_requests_count','')::numeric,0)),
    greatest(0,coalesce(nullif(x->>'priority_score','')::numeric,0)),
    greatest(0,coalesce(nullif(x->>'minimum_order_quantity','')::numeric,0)),
    greatest(0,coalesce(nullif(x->>'maximum_order_quantity','')::numeric,0))
  from jsonb_array_elements(p_items) x
  where greatest(0,coalesce(nullif(x->>'approved_quantity','')::numeric,0))>0;

  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',v_order,'items_count',v_count,'total',v_total));
end $$;

revoke all on function public.smart_purchase_create_order_from_plan_v2(text,uuid,text,text,numeric,numeric,numeric,jsonb) from public;
grant execute on function public.smart_purchase_create_order_from_plan_v2(text,uuid,text,text,numeric,numeric,numeric,jsonb) to anon,authenticated;

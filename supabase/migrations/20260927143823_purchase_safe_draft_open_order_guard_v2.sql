-- Prevent safe drafts from bypassing branch access or duplicating an open branch order.

CREATE OR REPLACE FUNCTION public.smart_purchase_safe_draft_create_v1(p_session_token text, p_branch text, p_target_budget numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  a record; v_preview jsonb; v_data jsonb; v_order_id uuid; v_order_number text; v_title text; v_item jsonb; v_analysis_id uuid; v_total numeric; v_items int;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;
  if exists(
    select 1 from public.smart_purchase_orders o
    where o.branch=p_branch
      and o.status in ('draft','مسودة','تم التحليل','معتمدة','تم الإرسال للمورد','partially_received','وصلت جزئيًا')
  ) then
    return jsonb_build_object('ok',false,'error','open_order_exists');
  end if;
  v_preview := public.smart_purchase_safe_draft_preview_v1(p_session_token,p_branch,p_target_budget);
  if coalesce(v_preview->>'ok','true')='false' then return v_preview; end if;
  v_data := v_preview->'data'; v_items := coalesce((v_data->>'items_count')::int,0); v_total := coalesce((v_data->>'estimated_total')::numeric,0);
  if v_items<=0 or v_total<=0 then return jsonb_build_object('ok',false,'error','empty_safe_draft','preview',v_data); end if;
  v_order_id := gen_random_uuid(); v_order_number := 'PO-AUTO-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(v_order_id::text,'-',''),1,4)); v_title := 'مسودة آمنة تلقائية - '||p_branch||' - '||to_char(current_date,'YYYY-MM-DD');
  insert into public.smart_purchase_orders(id,order_number,branch,title,status,budget,expected_total,approved_total,created_by_account_id,created_by_name,created_at,updated_at)
  values(v_order_id,v_order_number,p_branch,v_title,'مسودة',coalesce((v_data->>'planning_budget')::numeric,v_total),v_total,v_total,a.id,a.display_name,now(),now());
  for v_item in select value from jsonb_array_elements(coalesce(v_data->'plan','[]'::jsonb)) loop
    select pai.id into v_analysis_id from public.purchase_analysis_items pai where pai.branch=p_branch and ((nullif(trim(v_item->>'product_code'),'') is not null and pai.product_code=v_item->>'product_code') or public.purchase_normalize_product_name(pai.product_name)=public.purchase_normalize_product_name(v_item->>'product_name')) order by case when nullif(trim(v_item->>'product_code'),'') is not null and pai.product_code=v_item->>'product_code' then 0 else 1 end,pai.created_at desc limit 1;
    insert into public.smart_purchase_order_items(order_id,analysis_item_id,product_code,product_name,supplier_name,requested_quantity,approved_quantity,expected_unit_cost,expected_total,customer_requests_count,priority_score,status,notes,supplier_reason,manual_override,created_at,updated_at)
    values(v_order_id,v_analysis_id,nullif(trim(v_item->>'product_code'),''),v_item->>'product_name',null,coalesce((v_item->>'proposed_quantity')::numeric,0),coalesce((v_item->>'proposed_quantity')::numeric,0),coalesce((v_item->>'unit_cost')::numeric,0),coalesce((v_item->>'estimated_total')::numeric,0),coalesce((v_item->>'effective_customer_requests')::int,0),coalesce((v_item->>'priority_score')::numeric,0),'pending','تم إنشاؤه من المسودة الآمنة: '||coalesce(v_item->>'reason','احتياج استوك'),'المورد غير معتمد بعد — راجع عروض الموردين قبل اعتماد الطلبية',false,now(),now());
    v_analysis_id := null;
  end loop;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',v_order_id,'order_number',v_order_number,'title',v_title,'branch',p_branch,'status','مسودة','budget',coalesce((v_data->>'planning_budget')::numeric,v_total),'estimated_total',v_total,'items_count',v_items,'message','تم إنشاء مسودة فقط. لم يتم اعتمادها أو حجز سيولة أو إرسالها لأي مورد.'));
exception when others then
  if v_order_id is not null then delete from public.smart_purchase_orders where id=v_order_id; end if;
  raise;
end;
$function$;
revoke all on function public.smart_purchase_safe_draft_create_v1(text,text,numeric) from public;
grant execute on function public.smart_purchase_safe_draft_create_v1(text,text,numeric) to anon,authenticated;

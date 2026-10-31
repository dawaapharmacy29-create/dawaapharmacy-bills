create or replace function public.app_customer_order_workflow_v1(
  p_session_token text, p_action text, p_id uuid default null, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = 'public', 'extensions' as $function$
declare
  v_actor record;
  v_draft public.customer_order_drafts%rowtype;
  v_line public.customer_orders%rowtype;
  v_branch text;
  v_group_id uuid;
  v_rows jsonb;
  v_result jsonb;
  v_quantity integer;
  v_delta integer;
  v_status text;
  v_reason text;
  v_name text;
  v_unit text;
  v_new jsonb;
begin
  select a.id, a.role, a.display_name, a.branch_ids into v_actor
  from public.staff_sessions s join public.staff_accounts a on a.id=s.account_id
  where s.token_hash=encode(digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>now() and a.status='active'
  limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_actor.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;
  if p_action='list_drafts' then
    select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'branch',d.branch,'content',d.content,'updated_at',d.updated_at)
      order by d.updated_at desc),'[]'::jsonb) into v_rows
    from (select * from public.customer_order_drafts where
      (owner_account_id=v_actor.id or v_actor.role='general_manager')
      and (v_actor.role='general_manager' or branch in (select value from jsonb_array_elements_text(coalesce(v_actor.branch_ids,'[]'::jsonb)) x(value)))
      order by updated_at desc limit 100) d;
    return jsonb_build_object('ok',true,'data',v_rows);
  end if;
  if p_id is null then return jsonb_build_object('ok',false,'error','missing_id'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));

  if p_action='save_draft' then
    if exists (select 1 from public.customer_orders where order_group_id=p_id) then
      return jsonb_build_object('ok',false,'error','already_finalized');
    end if;
    if jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload)>65536 then
      return jsonb_build_object('ok',false,'error','invalid_draft');
    end if;
    v_branch := p_payload->'order'->>'branch';
    if v_branch not in ('دواء شكري','دواء الشامي') then return jsonb_build_object('ok',false,'error','invalid_branch'); end if;
    if v_actor.role <> 'general_manager' and not exists (
      select 1 from jsonb_array_elements_text(coalesce(v_actor.branch_ids,'[]'::jsonb)) x(value) where x.value=v_branch
    ) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
    if jsonb_typeof(p_payload->'lines') <> 'array' or jsonb_array_length(p_payload->'lines')>30 then
      return jsonb_build_object('ok',false,'error','invalid_lines'); end if;
    select * into v_draft from public.customer_order_drafts where id=p_id for update;
    if found then
      if v_draft.owner_account_id<>v_actor.id and v_actor.role<>'general_manager' then return jsonb_build_object('ok',false,'error','forbidden'); end if;
      update public.customer_order_drafts set content=p_payload,branch=v_branch,updated_at=now() where id=p_id;
    else
      insert into public.customer_order_drafts(id,owner_account_id,branch,content) values(p_id,v_actor.id,v_branch,p_payload);
    end if;
    return jsonb_build_object('ok',true,'data',jsonb_build_object('id',p_id,'draft',true));
  end if;

  if p_action in ('delete_draft','finalize_draft') then
    select * into v_draft from public.customer_order_drafts where id=p_id for update;
    if not found then
      if p_action='finalize_draft' then
        select jsonb_build_object('order_number',order_number,'order_group_id',p_id,'group_size',count(*),'already_saved',true)
          into v_new from public.customer_orders where order_group_id=p_id group by order_number limit 1;
        if v_new is not null then return jsonb_build_object('ok',true,'data',v_new); end if;
      end if;
      return jsonb_build_object('ok',false,'error','draft_not_found');
    end if;
    if v_draft.owner_account_id<>v_actor.id and v_actor.role<>'general_manager' then return jsonb_build_object('ok',false,'error','forbidden'); end if;
    if v_actor.role<>'general_manager' and not exists (
      select 1 from jsonb_array_elements_text(coalesce(v_actor.branch_ids,'[]'::jsonb)) x(value) where x.value=v_draft.branch
    ) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
    if p_action='delete_draft' then
      delete from public.customer_order_drafts where id=p_id;
      return jsonb_build_object('ok',true,'data',jsonb_build_object('deleted',true));
    end if;
    v_result := public.app_customer_order_batch_create_v1(p_session_token,p_id,v_draft.content->'order',v_draft.content->'lines');
    if coalesce((v_result->>'ok')::boolean,false) then
      delete from public.customer_order_drafts where id=p_id;
    end if;
    return v_result;
  end if;

  select order_group_id into v_group_id from public.customer_orders where id=p_id::text;
  if v_group_id is null then return jsonb_build_object('ok',false,'error','line_not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_group_id::text,1));
  select * into v_line from public.customer_orders where id=p_id::text for update;
  if not found or v_line.order_group_id is null then return jsonb_build_object('ok',false,'error','line_not_found'); end if;
  if v_actor.role<>'general_manager' and not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_actor.branch_ids,'[]'::jsonb)) x(value) where x.value=v_line.branch
  ) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  if v_line.status='تم التوصيل' then return jsonb_build_object('ok',false,'error','delivered_locked'); end if;
  if p_action in ('fulfill_line','edit_line','cancel_line','reopen_line','cancel_group','reopen_group') and
    (coalesce(p_payload->>'expected_updated_at','') !~ '^\d{4}-\d{2}-\d{2}T?\s?\d{2}:\d{2}:\d{2}' or
     (p_payload->>'expected_updated_at')::timestamptz is distinct from v_line.updated_at) then
    return jsonb_build_object('ok',false,'error','stale_order_reload');
  end if;
  if p_action in ('cancel_group','reopen_group') then
    v_reason:=trim(coalesce(p_payload->>'reason',''));
    if length(v_reason)<3 then return jsonb_build_object('ok',false,'error','reason_required'); end if;
    if exists (select 1 from public.customer_orders where order_group_id=v_line.order_group_id and status='تم التوصيل') then
      return jsonb_build_object('ok',false,'error','delivered_locked'); end if;
    if p_action='cancel_group' then
      update public.customer_orders set status='تم الإلغاء',cancellation_reason=v_reason,
        timeline=coalesce(timeline,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('status','تم الإلغاء','by',v_actor.display_name,'at',now(),'note','إلغاء الطلبية: '||v_reason)),updated_at=now()
        where order_group_id=v_line.order_group_id and status<>'تم الإلغاء';
    else
      update public.customer_orders set status=case when coalesce(fulfilled_quantity,0)=quantity then 'تم توفير الصنف' else 'طلب جديد' end,
        cancellation_reason=null,
        timeline=coalesce(timeline,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('status','إعادة فتح','by',v_actor.display_name,'at',now(),'note',v_reason)),updated_at=now()
        where order_group_id=v_line.order_group_id and status='تم الإلغاء';
    end if;
  elsif p_action='fulfill_line' then
    if v_line.status='تم الإلغاء' then return jsonb_build_object('ok',false,'error','cancelled_locked'); end if;
    if coalesce(p_payload->>'delta','') !~ '^[0-9]{1,5}$' then return jsonb_build_object('ok',false,'error','invalid_delta'); end if;
    v_delta := (p_payload->>'delta')::integer;
    if coalesce(p_payload->>'expected_fulfilled','') <> coalesce(v_line.fulfilled_quantity,0)::text then
      return jsonb_build_object('ok',false,'error','stale_quantity_reload'); end if;
    if v_delta<1 or v_line.quantity is null or coalesce(v_line.fulfilled_quantity,0)+v_delta>v_line.quantity then
      return jsonb_build_object('ok',false,'error','exceeds_remaining'); end if;
    v_quantity := coalesce(v_line.fulfilled_quantity,0)+v_delta;
    update public.customer_orders set fulfilled_quantity=v_quantity,
      status=case when v_quantity=quantity then 'تم توفير الصنف' else status end,
      timeline=coalesce(timeline,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('status','توفير جزئي','by',v_actor.display_name,'at',now(),'note','تم توفير '||v_delta||'؛ الإجمالي '||v_quantity)),updated_at=now()
      where id=v_line.id;
  elsif p_action='edit_line' then
    if v_line.status='تم الإلغاء' then return jsonb_build_object('ok',false,'error','cancelled_locked'); end if;
    v_name:=trim(coalesce(p_payload->>'product_name',''));
    v_unit:=p_payload->>'unit';
    if coalesce(p_payload->>'quantity','') !~ '^[0-9]{1,5}$' then return jsonb_build_object('ok',false,'error','invalid_quantity'); end if;
    v_quantity:=(p_payload->>'quantity')::integer;
    if length(v_name)<2 or length(v_name)>220 or v_quantity<greatest(1,coalesce(v_line.fulfilled_quantity,0)) or v_quantity>9999 or
      v_unit not in ('علبة','شريط','زجاجة','أمبول','فيال','كيس','قطعة') then
      return jsonb_build_object('ok',false,'error','invalid_line'); end if;
    update public.customer_orders set product_name=v_name, product_code=nullif(trim(coalesce(p_payload->>'product_code','')),''),
      quantity=v_quantity,unit=v_unit,
      status=case when coalesce(fulfilled_quantity,0)=v_quantity then 'تم توفير الصنف' when status='تم توفير الصنف' then 'طلب جديد' else status end,
      timeline=coalesce(timeline,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('status','تعديل','by',v_actor.display_name,'at',now(),'note','تعديل الصنف والكمية؛ السابق: '||coalesce(v_line.product_name,'')||' / '||coalesce(v_line.quantity::text,'غير محدد'))),updated_at=now()
      where id=v_line.id;
  elsif p_action in ('cancel_line','reopen_line') then
    v_reason:=trim(coalesce(p_payload->>'reason',''));
    if length(v_reason)<3 then return jsonb_build_object('ok',false,'error','reason_required'); end if;
    if p_action='cancel_line' and v_line.status='تم الإلغاء' then return jsonb_build_object('ok',false,'error','already_cancelled'); end if;
    if p_action='reopen_line' and v_line.status<>'تم الإلغاء' then return jsonb_build_object('ok',false,'error','not_cancelled'); end if;
    v_status:=case when p_action='cancel_line' then 'تم الإلغاء' when coalesce(v_line.fulfilled_quantity,0)=v_line.quantity then 'تم توفير الصنف' else 'طلب جديد' end;
    update public.customer_orders set status=v_status,
      cancellation_reason=case when p_action='cancel_line' then v_reason else null end,
      timeline=coalesce(timeline,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('status',v_status,'by',v_actor.display_name,'at',now(),'note',v_reason)),updated_at=now()
      where id=v_line.id;
  else
    return jsonb_build_object('ok',false,'error','invalid_action');
  end if;
  select jsonb_build_object('id',id,'status',status,'quantity',quantity,'fulfilled_quantity',fulfilled_quantity,'updated_at',updated_at) into v_new
    from public.customer_orders where id=v_line.id;
  return jsonb_build_object('ok',true,'data',v_new);
end;
$function$;
revoke all on function public.app_customer_order_workflow_v1(text,text,uuid,jsonb) from public;
grant execute on function public.app_customer_order_workflow_v1(text,text,uuid,jsonb) to anon,authenticated,service_role;

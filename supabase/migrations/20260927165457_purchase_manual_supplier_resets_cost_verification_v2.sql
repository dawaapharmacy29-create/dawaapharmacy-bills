create or replace function public.smart_purchase_apply_item_plan_cost_guarded_v2(
  p_session_token text,
  p_order_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  a record;
  o record;
  v_result jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select id,branch into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  v_result:=public.smart_purchase_apply_item_plan_package_guarded_v2(p_session_token,p_order_id,p_items);
  if coalesce((v_result->>'ok')::boolean,false)=false then return v_result; end if;

  update public.smart_purchase_order_items i
  set supplier_offer_id=null,
      supplier_reason=case when nullif(trim(x->>'supplier_name'),'') is null then null else 'اختيار مورد يدوي بواسطة '||coalesce(a.display_name,'المستخدم') end,
      cost_source=case when (x ? 'expected_unit_cost') and greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0))>0 then 'manual' else 'reference' end,
      cost_verified_at=case when (x ? 'expected_unit_cost') and greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0))>0 then now() else null end,
      cost_verified_by_account_id=case when (x ? 'expected_unit_cost') and greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0))>0 then a.id else null end,
      cost_verified_by_name=case when (x ? 'expected_unit_cost') and greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0))>0 then a.display_name else null end,
      updated_at=now()
  from jsonb_array_elements(p_items) x
  where i.order_id=p_order_id and i.id=(x->>'id')::uuid and x ? 'supplier_name';

  update public.smart_purchase_order_items i
  set cost_source='manual',
      cost_verified_at=now(),
      cost_verified_by_account_id=a.id,
      cost_verified_by_name=a.display_name,
      updated_at=now()
  from jsonb_array_elements(p_items) x
  where i.order_id=p_order_id and i.id=(x->>'id')::uuid
    and x ? 'expected_unit_cost'
    and greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0))>0;

  return v_result;
end $$;

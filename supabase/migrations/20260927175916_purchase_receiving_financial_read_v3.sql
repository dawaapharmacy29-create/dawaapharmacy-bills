create or replace function public.smart_purchase_receiving_read_v3(
  p_session_token text,p_action text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; v_order_id uuid; o public.smart_purchase_orders%rowtype;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  if p_action='list_orders' then
    return public.smart_purchase_receiving_read_v2(p_session_token,p_action,p_payload);
  elsif p_action='get_order' then
    v_order_id:=nullif(p_payload->>'id','')::uuid;
    select * into o from public.smart_purchase_orders where id=v_order_id;
    if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
    if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'order',to_jsonb(o),
      'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.supplier_name nulls last,i.product_name)
                        from public.smart_purchase_order_items i where i.order_id=v_order_id),'[]'::jsonb),
      'receipts',coalesce((
        select jsonb_agg(
          to_jsonb(r) || jsonb_build_object(
            'bonus_quantity',coalesce((select sum(coalesce(ri.bonus_quantity,0)) from public.purchase_order_receipt_items ri where ri.receipt_id=r.id),0),
            'items_count',coalesce((select count(*) from public.purchase_order_receipt_items ri where ri.receipt_id=r.id),0)
          ) order by r.created_at desc
        )
        from public.purchase_order_receipts r where r.order_id=v_order_id
      ),'[]'::jsonb)
    ));
  end if;
  return jsonb_build_object('ok',false,'error','unsupported_action');
end $$;

revoke all on function public.smart_purchase_receiving_read_v3(text,text,jsonb) from public;
grant execute on function public.smart_purchase_receiving_read_v3(text,text,jsonb) to anon,authenticated;

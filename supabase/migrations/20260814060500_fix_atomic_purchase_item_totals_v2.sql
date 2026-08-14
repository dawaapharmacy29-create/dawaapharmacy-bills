create or replace function public.smart_purchase_apply_budget_plan(p_session_token text,p_order_id uuid,p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp','extensions'
as $function$
declare
  v_auth jsonb;
  v_updated integer := 0;
  v_expected integer := 0;
  v_total numeric := 0;
begin
  perform set_config('statement_timeout','20000',true);
  if coalesce(trim(p_session_token),'')='' then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select public.smart_purchase_unified(p_session_token,'dashboard','{}'::jsonb) into v_auth;
  if coalesce((v_auth->>'ok')::boolean,false) is not true then return jsonb_build_object('ok',false,'error',coalesce(v_auth->>'error','invalid_session')); end if;
  if jsonb_typeof(p_items)<>'array' then return jsonb_build_object('ok',false,'error','invalid_items'); end if;
  if not exists(select 1 from public.smart_purchase_orders where id=p_order_id) then return jsonb_build_object('ok',false,'error','order_not_found'); end if;

  select count(*) into v_expected from jsonb_array_elements(p_items);
  if v_expected=0 then return jsonb_build_object('ok',false,'error','empty_plan'); end if;

  with plan as materialized (
    select (x->>'id')::uuid id,greatest(0,floor(coalesce(nullif(x->>'approved_quantity','')::numeric,0))) qty
    from jsonb_array_elements(p_items) x
  ), updated as (
    update public.smart_purchase_order_items i
    set approved_quantity=p.qty,expected_total=p.qty*greatest(0,coalesce(i.expected_unit_cost,0)),manual_override=true,updated_at=now()
    from plan p
    where i.id=p.id and i.order_id=p_order_id and i.approved_quantity is distinct from p.qty
    returning i.id
  ) select count(*) into v_updated from updated;

  select coalesce(sum(greatest(0,coalesce(approved_quantity,0))*greatest(0,coalesce(expected_unit_cost,0))),0)
    into v_total from public.smart_purchase_order_items where order_id=p_order_id;
  update public.smart_purchase_orders set approved_total=v_total,expected_total=v_total,updated_at=now() where id=p_order_id;

  return jsonb_build_object('ok',true,'data',jsonb_build_object('updated',v_updated,'submitted',v_expected,'order_total',v_total));
exception when others then return jsonb_build_object('ok',false,'error','apply_failed','message',sqlerrm); end;
$function$;

grant execute on function public.smart_purchase_apply_budget_plan(text,uuid,jsonb) to anon,authenticated;

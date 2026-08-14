create or replace function public.smart_purchase_import_supplier_offers_v1(
  p_session_token text,
  p_source_file_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare
  a record;
  r jsonb;
  s public.suppliers%rowtype;
  v_supplier_name text;
  v_product_name text;
  v_product_code text;
  v_list_price numeric;
  v_discount numeric;
  v_extra_discount numeric;
  v_bonus_qty numeric;
  v_bonus_base numeric;
  v_net numeric;
  v_effective numeric;
  v_available numeric;
  v_moq numeric;
  v_lead int;
  v_payment text;
  v_valid date;
  v_is_available boolean;
  v_imported int := 0;
  v_rejected int := 0;
  v_rows_seen int := 0;
  v_rejections jsonb := '[]'::jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','purchasing','branch_manager') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_rows_seen := v_rows_seen + 1;
    v_supplier_name := nullif(trim(r->>'supplier_name'),'');
    v_product_name := nullif(trim(r->>'product_name'),'');
    v_product_code := nullif(trim(r->>'product_code'),'');

    if v_supplier_name is null or v_product_name is null then
      v_rejected := v_rejected + 1;
      v_rejections := v_rejections || jsonb_build_array(jsonb_build_object('row',v_rows_seen,'reason','supplier_or_product_missing','supplier_name',v_supplier_name,'product_name',v_product_name));
      continue;
    end if;

    select * into s from public.suppliers
    where lower(trim(name))=lower(v_supplier_name)
    order by is_sample asc nulls first, created_at asc nulls last limit 1;
    if not found then
      v_rejected := v_rejected + 1;
      v_rejections := v_rejections || jsonb_build_array(jsonb_build_object('row',v_rows_seen,'reason','supplier_not_found','supplier_name',v_supplier_name,'product_name',v_product_name));
      continue;
    end if;

    begin v_list_price := greatest(0,coalesce(nullif(r->>'list_price','')::numeric,nullif(r->>'price','')::numeric,0)); exception when others then v_list_price:=0; end;
    begin v_discount := least(100,greatest(0,coalesce(nullif(r->>'discount_percent','')::numeric,0))); exception when others then v_discount:=0; end;
    begin v_extra_discount := least(100,greatest(0,coalesce(nullif(r->>'extra_discount_percent','')::numeric,0))); exception when others then v_extra_discount:=0; end;
    begin v_bonus_qty := greatest(0,coalesce(nullif(r->>'bonus_quantity','')::numeric,0)); exception when others then v_bonus_qty:=0; end;
    begin v_bonus_base := greatest(0,coalesce(nullif(r->>'bonus_base_quantity','')::numeric,0)); exception when others then v_bonus_base:=0; end;
    begin v_available := greatest(0,coalesce(nullif(r->>'available_quantity','')::numeric,0)); exception when others then v_available:=0; end;
    begin v_moq := greatest(0,coalesce(nullif(r->>'minimum_order_quantity','')::numeric,0)); exception when others then v_moq:=0; end;
    begin v_lead := greatest(0,coalesce(nullif(r->>'lead_time_days','')::int,0)); exception when others then v_lead:=0; end;
    begin v_valid := nullif(trim(r->>'valid_until'),'')::date; exception when others then v_valid:=null; end;
    begin v_is_available := coalesce(nullif(r->>'is_available','')::boolean,true); exception when others then v_is_available:=true; end;
    v_payment := coalesce(nullif(trim(r->>'payment_type'),''),nullif(trim(s.payment_type),''),'غير محدد');

    begin v_net := greatest(0,coalesce(nullif(r->>'net_unit_cost','')::numeric,0)); exception when others then v_net:=0; end;
    if v_net<=0 then
      v_net := round((v_list_price * (1-v_discount/100.0) * (1-v_extra_discount/100.0))::numeric,4);
    end if;
    if v_net<=0 then
      v_rejected := v_rejected + 1;
      v_rejections := v_rejections || jsonb_build_array(jsonb_build_object('row',v_rows_seen,'reason','invalid_cost','supplier_name',v_supplier_name,'product_name',v_product_name));
      continue;
    end if;

    v_effective := case when v_bonus_base>0 and v_bonus_qty>0 then round((v_net*v_bonus_base/(v_bonus_base+v_bonus_qty))::numeric,4) else v_net end;

    update public.supplier_product_offers o set
      is_available=false,
      valid_until=least(coalesce(o.valid_until,current_date-1),current_date-1),
      updated_at=now()
    where lower(trim(o.supplier_name))=lower(trim(s.name))
      and (
        (v_product_code is not null and nullif(trim(o.product_code),'')=v_product_code)
        or (v_product_code is null and lower(trim(o.product_name))=lower(v_product_name))
      )
      and o.is_available=true;

    insert into public.supplier_product_offers(
      product_code,product_name,supplier_id,supplier_name,list_price,discount_percent,bonus_quantity,bonus_base_quantity,
      extra_discount_percent,net_unit_cost,available_quantity,minimum_order_quantity,lead_time_days,payment_type,valid_until,
      is_available,source_file_name,created_by_account_id,created_by_name,effective_cost_after_bonus,service_score
    ) values (
      v_product_code,v_product_name,s.id,s.name,v_list_price,v_discount,v_bonus_qty,v_bonus_base,v_extra_discount,v_net,v_available,
      v_moq,v_lead,v_payment,v_valid,v_is_available,coalesce(nullif(trim(p_source_file_name),''),'manual-import'),a.id,a.display_name,
      v_effective,greatest(0,100-least(60,v_lead*4))
    );
    v_imported := v_imported + 1;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'rows_seen',v_rows_seen,
    'imported',v_imported,
    'rejected',v_rejected,
    'rejections',v_rejections,
    'active_offers',(select count(*) from public.supplier_product_offers where is_available=true and (valid_until is null or valid_until>=current_date)),
    'active_suppliers',(select count(distinct supplier_name) from public.supplier_product_offers where is_available=true and (valid_until is null or valid_until>=current_date)),
    'active_products',(select count(distinct coalesce(nullif(trim(product_code),''),lower(trim(product_name)))) from public.supplier_product_offers where is_available=true and (valid_until is null or valid_until>=current_date))
  );
end;
$$;

grant execute on function public.smart_purchase_import_supplier_offers_v1(text,text,jsonb) to anon,authenticated;

create or replace function public.smart_purchase_supplier_offer_health_v1(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare a record;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','purchasing','branch_manager','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  return jsonb_build_object('ok',true,
    'active_offers',(select count(*) from public.supplier_product_offers where is_available=true and (valid_until is null or valid_until>=current_date)),
    'active_suppliers',(select count(distinct supplier_name) from public.supplier_product_offers where is_available=true and (valid_until is null or valid_until>=current_date)),
    'active_products',(select count(distinct coalesce(nullif(trim(product_code),''),lower(trim(product_name)))) from public.supplier_product_offers where is_available=true and (valid_until is null or valid_until>=current_date)),
    'expiring_7_days',(select count(*) from public.supplier_product_offers where is_available=true and valid_until between current_date and current_date+7),
    'expired_active',(select count(*) from public.supplier_product_offers where is_available=true and valid_until<current_date),
    'last_import_at',(select max(created_at) from public.supplier_product_offers)
  );
end;
$$;

grant execute on function public.smart_purchase_supplier_offer_health_v1(text) to anon,authenticated;

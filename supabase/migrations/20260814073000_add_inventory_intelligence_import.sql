create table if not exists public.purchase_inventory_batches (
  id uuid primary key default gen_random_uuid(),
  branch text not null,
  product_key text not null,
  product_code text,
  product_name text not null,
  batch_number text not null default 'UNSPECIFIED',
  expiry_date date not null,
  quantity numeric not null default 0,
  unit_cost numeric not null default 0,
  selling_price numeric not null default 0,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.staff_accounts(id) on delete set null,
  unique(branch,product_key,batch_number,expiry_date)
);
create index if not exists idx_purchase_inventory_batches_expiry on public.purchase_inventory_batches(branch,expiry_date);

create or replace function public.smart_purchase_inventory_intelligence_import(
  p_session_token text,
  p_branch text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  a record; r jsonb; v_code text; v_name text; v_key text; v_batch text; v_expiry date;
  v_qty numeric; v_cost numeric; v_sell numeric; v_count int:=0; v_updated int:=0;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  if a.role='branch_manager' and not (
    coalesce(a.branch_ids,'[]'::jsonb) ? coalesce(p_branch,'') or
    coalesce(a.branch_ids,'[]'::jsonb) ? replace(coalesce(p_branch,''),'دواء ','') or
    coalesce(a.branch_ids,'[]'::jsonb) ? replace(coalesce(p_branch,''),'فرع ','')
  ) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_name:=nullif(trim(r->>'product_name'),'');
    v_code:=nullif(trim(r->>'product_code'),'');
    if v_name is null then continue; end if;
    v_key:=coalesce(v_code,lower(regexp_replace(v_name,'[\s_\-]+',' ','g')));
    v_sell:=greatest(0,coalesce(nullif(r->>'selling_price','')::numeric,0));
    v_cost:=greatest(0,coalesce(nullif(r->>'unit_cost','')::numeric,nullif(r->>'last_purchase_price','')::numeric,0));
    v_qty:=greatest(0,coalesce(nullif(r->>'expiry_quantity','')::numeric,nullif(r->>'quantity','')::numeric,0));
    v_batch:=coalesce(nullif(trim(r->>'batch_number'),''),'UNSPECIFIED');
    begin v_expiry:=nullif(trim(r->>'expiry_date'),'')::date; exception when others then v_expiry:=null; end;

    if v_sell>0 then
      update public.purchase_analysis_items x set selling_price=v_sell
      where x.id=(select y.id from public.purchase_analysis_items y
        where y.branch=p_branch and ((v_code is not null and y.product_code=v_code) or lower(trim(y.product_name))=lower(trim(v_name)))
        order by y.created_at desc limit 1);
      if found then v_updated:=v_updated+1; end if;
    end if;

    if v_expiry is not null and v_qty>0 then
      insert into public.purchase_inventory_batches(branch,product_key,product_code,product_name,batch_number,expiry_date,quantity,unit_cost,selling_price,imported_by)
      values(p_branch,v_key,v_code,v_name,v_batch,v_expiry,v_qty,v_cost,v_sell,a.id)
      on conflict(branch,product_key,batch_number,expiry_date) do update set
        product_code=excluded.product_code,product_name=excluded.product_name,quantity=excluded.quantity,
        unit_cost=case when excluded.unit_cost>0 then excluded.unit_cost else public.purchase_inventory_batches.unit_cost end,
        selling_price=case when excluded.selling_price>0 then excluded.selling_price else public.purchase_inventory_batches.selling_price end,
        imported_at=now(),imported_by=excluded.imported_by;
    end if;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('rows_processed',v_count,'products_price_updated',v_updated));
end;
$$;

grant execute on function public.smart_purchase_inventory_intelligence_import(text,text,jsonb) to anon,authenticated;

create or replace function public.smart_purchase_inventory_command_center_v3(
  p_session_token text,
  p_branch text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  a record; v_base jsonb; v_expiry jsonb:='[]'::jsonb; v_expiry_count int:=0;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  v_base:=public.smart_purchase_inventory_command_center_v2(p_session_token,p_branch);
  if coalesce((v_base->>'ok')::boolean,false)=false then return v_base; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'branch',b.branch,'product_code',b.product_code,'product_name',b.product_name,'batch_number',b.batch_number,
    'expiry_date',b.expiry_date,'days_to_expiry',(b.expiry_date-current_date),'expiry_quantity',b.quantity,
    'unit_cost',b.unit_cost,'selling_price',b.selling_price,'expiry_value',round((b.quantity*b.unit_cost)::numeric,2),
    'risk_level',case when b.expiry_date<current_date then 'expired' when b.expiry_date<=current_date+30 then 'critical' when b.expiry_date<=current_date+60 then 'high' when b.expiry_date<=current_date+90 then 'watch' else 'normal' end
  ) order by b.expiry_date asc,(b.quantity*b.unit_cost) desc),'[]'::jsonb),count(*)
  into v_expiry,v_expiry_count
  from public.purchase_inventory_batches b
  where b.quantity>0 and b.expiry_date<=current_date+180
    and (coalesce(p_branch,'all')='all' or b.branch=p_branch)
    and (a.role<>'branch_manager' or coalesce(a.branch_ids,'[]'::jsonb) ? b.branch or coalesce(a.branch_ids,'[]'::jsonb) ? replace(b.branch,'دواء ','') or coalesce(a.branch_ids,'[]'::jsonb) ? replace(b.branch,'فرع ',''));

  return v_base || jsonb_build_object(
    'near_expiry',v_expiry,
    'readiness',(v_base->'readiness') || jsonb_build_object(
      'expiry_ready',v_expiry_count>0,
      'expiry_reason',case when v_expiry_count>0 then 'تم الحساب على مستوى الـBatch والكميات الفعلية.' else 'ارفع Batch + Expiry Date + Expiry Quantity لتفعيل رادار الصلاحية.' end
    )
  );
end;
$$;

grant execute on function public.smart_purchase_inventory_command_center_v3(text,text) to anon,authenticated;
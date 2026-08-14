alter table public.purchase_analysis_items
  add column if not exists selling_price numeric,
  add column if not exists batch_number text,
  add column if not exists expiry_date date,
  add column if not exists expiry_quantity numeric;

create or replace function public.purchase_analysis_enrich_optional_fields()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
declare
  v_expiry text;
begin
  if new.source_row is not null then
    new.selling_price := coalesce(new.selling_price, nullif(new.source_row->>'selling_price','')::numeric);
    new.batch_number := coalesce(nullif(new.batch_number,''), nullif(trim(new.source_row->>'batch_number'),''));
    new.expiry_quantity := coalesce(new.expiry_quantity, nullif(new.source_row->>'expiry_quantity','')::numeric, new.current_stock);
    v_expiry := nullif(trim(new.source_row->>'expiry_date'),'');
    if new.expiry_date is null and v_expiry is not null and v_expiry ~ '^\d{4}-\d{2}-\d{2}$' then
      new.expiry_date := v_expiry::date;
    end if;
  end if;
  new.selling_price := greatest(0,coalesce(new.selling_price,0));
  new.expiry_quantity := greatest(0,coalesce(new.expiry_quantity,0));
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_purchase_analysis_enrich_optional_fields on public.purchase_analysis_items;
create trigger trg_purchase_analysis_enrich_optional_fields
before insert or update of source_row,selling_price,batch_number,expiry_date,expiry_quantity
on public.purchase_analysis_items
for each row execute function public.purchase_analysis_enrich_optional_fields();

create or replace function public.smart_purchase_inventory_command_center_v2(
  p_session_token text,
  p_branch text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare
  v_account record;
  v_base jsonb;
  v_profit jsonb := '[]'::jsonb;
  v_expiry jsonb := '[]'::jsonb;
  v_doctor jsonb := '[]'::jsonb;
  v_profit_count int := 0;
  v_expiry_count int := 0;
begin
  perform set_config('statement_timeout','25000',true);
  select sa.* into v_account
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  v_base := public.smart_purchase_inventory_command_center_v1(p_session_token,p_branch);
  if coalesce((v_base->>'ok')::boolean,false)=false then return v_base; end if;

  with latest as (
    select distinct on (pai.branch,coalesce(nullif(trim(pai.product_code),''),lower(trim(pai.product_name)))) pai.*
    from public.purchase_analysis_items pai
    where (coalesce(p_branch,'all')='all' or pai.branch=p_branch)
      and (v_account.role<>'branch_manager'
        or coalesce(v_account.branch_ids,'[]'::jsonb) ? coalesce(pai.branch,'')
        or coalesce(v_account.branch_ids,'[]'::jsonb) ? replace(coalesce(pai.branch,''),'دواء ','')
        or coalesce(v_account.branch_ids,'[]'::jsonb) ? replace(coalesce(pai.branch,''),'فرع ',''))
    order by pai.branch,coalesce(nullif(trim(pai.product_code),''),lower(trim(pai.product_name))),pai.created_at desc
  ), m as (
    select branch,product_code,product_name,
      greatest(0,coalesce(current_stock,0))::numeric current_stock,
      greatest(0,coalesce(safety_stock,0))::numeric safety_stock,
      greatest(0,coalesce(sales_30,0))::numeric sales_30,
      greatest(0,coalesce(avg_daily_usage,0),coalesce(sales_30,0)/30.0,coalesce(sales_60,0)/60.0,coalesce(sales_90,0)/90.0)::numeric usage_per_day,
      greatest(0,coalesce(last_purchase_price,expected_unit_cost,0))::numeric unit_cost,
      greatest(0,coalesce(selling_price,0))::numeric selling_price,
      nullif(trim(batch_number),'') batch_number,
      expiry_date,
      greatest(0,coalesce(expiry_quantity,current_stock,0))::numeric expiry_quantity
    from latest where coalesce(trim(product_name),'')<>''
  ), calc as (
    select m.*,
      greatest(0,selling_price-unit_cost)::numeric gross_margin_unit,
      case when selling_price>0 then round((greatest(0,selling_price-unit_cost)/selling_price*100)::numeric,1) else 0 end margin_percent,
      round((current_stock*unit_cost)::numeric,2) stock_value,
      round((sales_30*greatest(0,selling_price-unit_cost))::numeric,2) gross_profit_30,
      case when current_stock*unit_cost>0 then round(((sales_30*greatest(0,selling_price-unit_cost))/(current_stock*unit_cost))::numeric,2) else null end gmroi_30,
      case when expiry_date is not null then (expiry_date-current_date) else null end days_to_expiry,
      round((expiry_quantity*unit_cost)::numeric,2) expiry_value
    from m
  )
  select
    coalesce((select jsonb_agg(x.obj order by x.profit30 desc,x.gmroi desc nulls last) from (
      select jsonb_build_object(
        'branch',branch,'product_code',product_code,'product_name',product_name,
        'current_stock',current_stock,'sales_30',sales_30,'unit_cost',unit_cost,'selling_price',selling_price,
        'gross_margin_unit',gross_margin_unit,'margin_percent',margin_percent,'gross_profit_30',gross_profit_30,
        'stock_value',stock_value,'gmroi_30',gmroi_30,'usage_per_day',round(usage_per_day,3)
      ) obj,gross_profit_30 profit30,coalesce(gmroi_30,0) gmroi
      from calc where selling_price>unit_cost and sales_30>0
      order by gross_profit_30 desc,gmroi_30 desc nulls last limit 50
    ) x),'[]'::jsonb),
    coalesce((select jsonb_agg(x.obj order by x.days asc,x.risk desc) from (
      select jsonb_build_object(
        'branch',branch,'product_code',product_code,'product_name',product_name,'batch_number',batch_number,
        'expiry_date',expiry_date,'days_to_expiry',days_to_expiry,'expiry_quantity',expiry_quantity,
        'unit_cost',unit_cost,'expiry_value',expiry_value,
        'risk_level',case when days_to_expiry<0 then 'expired' when days_to_expiry<=30 then 'critical' when days_to_expiry<=60 then 'high' when days_to_expiry<=90 then 'watch' else 'normal' end
      ) obj,days_to_expiry days,expiry_value risk
      from calc where expiry_date is not null and expiry_quantity>0 and days_to_expiry<=180
      order by days_to_expiry asc,expiry_value desc limit 100
    ) x),'[]'::jsonb),
    coalesce((select jsonb_agg(x.obj order by x.score desc) from (
      select jsonb_build_object(
        'branch',branch,'product_code',product_code,'product_name',product_name,
        'current_stock',current_stock,'sales_30',sales_30,'selling_price',selling_price,'unit_cost',unit_cost,
        'gross_margin_unit',gross_margin_unit,'margin_percent',margin_percent,'gross_profit_30',gross_profit_30,
        'gmroi_30',gmroi_30,'suggested_push_units',greatest(1,least(floor(greatest(0,current_stock-safety_stock)),ceil(greatest(1,usage_per_day*14))))::int,
        'doctor_score',round((gross_profit_30 + gross_margin_unit*least(greatest(0,current_stock-safety_stock),greatest(1,usage_per_day*14))*1.25 + margin_percent*3)::numeric,1),
        'reason','ربحية + حركة + رصيد متاح للبيع بدون الضغط على مخزون الأمان'
      ) obj,
      (gross_profit_30 + gross_margin_unit*least(greatest(0,current_stock-safety_stock),greatest(1,usage_per_day*14))*1.25 + margin_percent*3) score
      from calc
      where selling_price>unit_cost and current_stock>safety_stock
        and (expiry_date is null or expiry_date-current_date>60)
      order by score desc limit 20
    ) x),'[]'::jsonb),
    (select count(*) from calc where selling_price>unit_cost and sales_30>0),
    (select count(*) from calc where expiry_date is not null and expiry_quantity>0)
  into v_profit,v_expiry,v_doctor,v_profit_count,v_expiry_count;

  return v_base
    || jsonb_build_object(
      'profitability',v_profit,
      'near_expiry',v_expiry,
      'doctor_profit_list',v_doctor,
      'readiness',jsonb_build_object(
        'profitability_ready',v_profit_count>0,
        'profitability_reason',case when v_profit_count>0 then 'تم الحساب من سعر البيع وصافي تكلفة الشراء ومبيعات 30 يوم.' else 'ارفع سعر البيع في ملف المخزون لتفعيل الربحية وGMROI.' end,
        'expiry_ready',v_expiry_count>0,
        'expiry_reason',case when v_expiry_count>0 then 'تم ربط تواريخ الصلاحية والكميات المتاحة.' else 'ارفع Batch + Expiry Date + Expiry Quantity لتفعيل رادار الصلاحية.' end,
        'doctor_profit_list_ready',jsonb_array_length(v_doctor)>0,
        'doctor_profit_list_reason',case when jsonb_array_length(v_doctor)>0 then 'اللستة مرتبة حسب الربح والحركة والرصيد الآمن.' else 'تحتاج سعر بيع موثوق ورصيد متاح وحركة فعلية.' end
      ),
      'profit_method',jsonb_build_object(
        'gross_profit_30','(سعر البيع - تكلفة الشراء) × مبيعات 30 يوم',
        'gmroi_30','إجمالي ربح 30 يوم ÷ قيمة المخزون الحالية',
        'doctor_score','ربحية 30 يوم + ربح الوحدات القابلة للدفع + هامش الربح، مع استبعاد الصلاحية <=60 يوم'
      )
    );
end;
$$;

grant execute on function public.smart_purchase_inventory_command_center_v2(text,text) to anon, authenticated;
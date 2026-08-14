create or replace function public.app_data_read_rows(p_session_token text, p_entity text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_table text;
  v_rows jsonb;
  v_valid boolean;
  v_allowed_branches text[];
  v_role text;
begin
  select true,
         a.role,
         case
           when jsonb_typeof(coalesce(a.branch_ids, '[]'::jsonb)) = 'array'
             then coalesce(array(select jsonb_array_elements_text(coalesce(a.branch_ids, '[]'::jsonb))), array[]::text[])
           else array[]::text[]
         end
    into v_valid, v_role, v_allowed_branches
  from public.staff_sessions s
  join public.staff_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and a.status = 'active'
  order by s.created_at desc
  limit 1;

  if not coalesce(v_valid,false) then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  update public.staff_sessions set last_seen_at=now()
  where token_hash=encode(digest(coalesce(p_session_token,''),'sha256'),'hex') and revoked_at is null;

  v_table:=case p_entity
    when 'Supplier' then 'suppliers' when 'TeamMember' then 'team_members'
    when 'PurchaseInvoice' then 'purchase_invoices' when 'SupplierPayment' then 'supplier_payments'
    when 'SupplierDebt' then 'supplier_opening_balances' when 'SupplierMonthStart' then 'supplier_account_starts'
    when 'Return' then 'purchase_returns' when 'PharmacyOrder' then 'pharmacy_orders'
    when 'CustomerOrder' then 'customer_orders' when 'Expense' then 'expenses'
    when 'ReplenishmentOrder' then 'replenishment_orders' when 'ShiftDelivery' then 'shift_deliveries'
    when 'ReportSettings' then 'report_settings' when 'TargetGoal' then 'target_goals'
    else null end;

  if v_table is not null then
    if v_role='general_manager' or v_table not in ('customer_orders','expenses','pharmacy_orders','shift_deliveries','purchase_invoices') then
      if v_table='purchase_invoices' then
        execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where coalesce(t.is_sample,false)=false and coalesce(t.base44_sync_state,''active'')=''active''',v_table) into v_rows;
      else
        execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',v_table) into v_rows;
      end if;
    elsif cardinality(v_allowed_branches)>0 then
      if v_table='purchase_invoices' then
        execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where coalesce(t.is_sample,false)=false and coalesce(t.base44_sync_state,''active'')=''active'' and t.branch=any($1)',v_table)
          into v_rows using v_allowed_branches;
      else
        execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where t.branch=any($1)',v_table)
          into v_rows using v_allowed_branches;
      end if;
    else
      v_rows:='[]'::jsonb;
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'created_at',r.created_at,'updated_at',r.updated_at)||r.data),'[]'::jsonb)
      into v_rows from public.app_entity_records r where r.entity_name=p_entity;
  end if;

  return jsonb_build_object('ok',true,'data',coalesce(v_rows,'[]'::jsonb));
end;
$function$;

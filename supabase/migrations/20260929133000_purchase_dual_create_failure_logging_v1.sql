-- Diagnostic-only logging for atomic dual-draft failures.
-- No behavior change: failures still roll back both draft creations together.

CREATE OR REPLACE FUNCTION public.smart_purchase_create_dual_drafts_v1(p_session_token text, p_stock_sync_id text, p_plan_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
 SET statement_timeout TO '15s'
AS $function$
declare
  a record;
  v_existing public.smart_purchase_dual_plan_runs%rowtype;
  v_plan_response jsonb;
  v_plan jsonb;
  v_shokry_items jsonb;
  v_shamy_items jsonb;
  v_shokry_import uuid;
  v_shamy_import uuid;
  v_shokry_result jsonb;
  v_shamy_result jsonb;
  v_shokry_order uuid;
  v_shamy_order uuid;
  v_shokry_expected_hash text;
  v_shokry_persisted_hash text;
  v_shamy_expected_hash text;
  v_shamy_persisted_hash text;
  v_err text;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null
    and ss.expires_at>now()
    and sa.status='active'
  order by ss.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if coalesce(trim(p_stock_sync_id),'')='' or coalesce(trim(p_plan_hash),'')='' then
    return jsonb_build_object('ok',false,'error','invalid_dual_plan_identity');
  end if;

  perform pg_advisory_xact_lock(hashtext('dual-purchase-plan:'||p_plan_hash));

  select * into v_existing
  from public.smart_purchase_dual_plan_runs
  where plan_hash=p_plan_hash;

  if found then
    return jsonb_build_object(
      'ok',true,
      'data',jsonb_build_object(
        'already_created',true,
        'plan_hash',v_existing.plan_hash,
        'stock_sync_id',v_existing.stock_sync_id,
        'shokry_order_id',v_existing.shokry_order_id,
        'shamy_order_id',v_existing.shamy_order_id,
        'shokry_items_hash',v_existing.shokry_items_hash,
        'shamy_items_hash',v_existing.shamy_items_hash
      )
    );
  end if;

  select public.smart_purchase_dual_branch_instant_plan_v1(
    p_session_token,
    null,
    null
  ) into v_plan_response;

  if coalesce((v_plan_response->>'ok')::boolean,false)=false then
    return v_plan_response;
  end if;

  v_plan:=v_plan_response->'data';

  if coalesce(v_plan->>'stock_sync_id','')<>p_stock_sync_id then
    return jsonb_build_object('ok',false,'error','stock_sync_mismatch');
  end if;

  if coalesce(v_plan->>'plan_hash','')<>p_plan_hash then
    return jsonb_build_object('ok',false,'error','plan_hash_mismatch');
  end if;

  if coalesce((v_plan->'shokry'->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false)=false
     or coalesce((v_plan->'shamy'->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false)=false then
    return jsonb_build_object('ok',false,'error','stale_plan_data','data',jsonb_build_object(
      'shokry_ready',coalesce((v_plan->'shokry'->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false),
      'shamy_ready',coalesce((v_plan->'shamy'->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false)
    ));
  end if;

  if coalesce((v_plan->'creation_guard'->>'can_create_dual')::boolean,false)=false then
    return jsonb_build_object('ok',false,'error','dual_creation_guard_blocked','data',v_plan->'creation_guard');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_code',x->>'product_code',
    'product_name',x->>'product_name',
    'requested_quantity',coalesce((x->>'buy_quantity')::numeric,0),
    'approved_quantity',coalesce((x->>'buy_quantity')::numeric,0),
    'expected_unit_cost',coalesce((x->>'unit_cost')::numeric,0),
    'customer_requests_count',coalesce((x->>'customer_requests_count')::numeric,0),
    'priority_score',coalesce((x->>'priority_score')::numeric,0),
    'minimum_order_quantity',0,
    'maximum_order_quantity',0,
    'package_multiple',0,
    'transfer_from_branch',x->>'transfer_from_branch',
    'suggested_transfer_quantity',coalesce((x->>'suggested_transfer_qty')::numeric,0),
    'gross_need_before_transfer',coalesce((x->>'gross_need')::numeric,0),
    'movement_class',x->>'stock_state',
    'smart_purchase_decision',x->>'decision'
  )),'[]'::jsonb)
  into v_shokry_items
  from jsonb_array_elements(coalesce(v_plan->'shokry'->'plan','[]'::jsonb)) x
  where coalesce((x->>'buy_quantity')::numeric,0)>0;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_code',x->>'product_code',
    'product_name',x->>'product_name',
    'requested_quantity',coalesce((x->>'buy_quantity')::numeric,0),
    'approved_quantity',coalesce((x->>'buy_quantity')::numeric,0),
    'expected_unit_cost',coalesce((x->>'unit_cost')::numeric,0),
    'customer_requests_count',coalesce((x->>'customer_requests_count')::numeric,0),
    'priority_score',coalesce((x->>'priority_score')::numeric,0),
    'minimum_order_quantity',0,
    'maximum_order_quantity',0,
    'package_multiple',0,
    'transfer_from_branch',x->>'transfer_from_branch',
    'suggested_transfer_quantity',coalesce((x->>'suggested_transfer_qty')::numeric,0),
    'gross_need_before_transfer',coalesce((x->>'gross_need')::numeric,0),
    'movement_class',x->>'stock_state',
    'smart_purchase_decision',x->>'decision'
  )),'[]'::jsonb)
  into v_shamy_items
  from jsonb_array_elements(coalesce(v_plan->'shamy'->'plan','[]'::jsonb)) x
  where coalesce((x->>'buy_quantity')::numeric,0)>0;

  if jsonb_array_length(v_shokry_items)=0 and jsonb_array_length(v_shamy_items)=0 then
    return jsonb_build_object('ok',false,'error','empty_plan');
  end if;

  begin
    insert into public.purchase_analysis_imports(
      file_name,branch,status,row_count,valid_count,error_count,settings,
      created_by_account_id,created_by_name
    ) values(
      'dual-plan-'||left(p_plan_hash,12)||'-shokry',
      'دواء شكري',
      'processed',
      jsonb_array_length(v_shokry_items),
      jsonb_array_length(v_shokry_items),
      0,
      jsonb_build_object(
        'planner','dual_branch_instant_plan_v1',
        'stock_sync_id',p_stock_sync_id,
        'plan_hash',p_plan_hash
      ),
      a.id,a.display_name
    ) returning id into v_shokry_import;

    insert into public.purchase_analysis_imports(
      file_name,branch,status,row_count,valid_count,error_count,settings,
      created_by_account_id,created_by_name
    ) values(
      'dual-plan-'||left(p_plan_hash,12)||'-shamy',
      'دواء الشامي',
      'processed',
      jsonb_array_length(v_shamy_items),
      jsonb_array_length(v_shamy_items),
      0,
      jsonb_build_object(
        'planner','dual_branch_instant_plan_v1',
        'stock_sync_id',p_stock_sync_id,
        'plan_hash',p_plan_hash
      ),
      a.id,a.display_name
    ) returning id into v_shamy_import;

    if jsonb_array_length(v_shokry_items)>0 then
      select public.smart_purchase_create_order_from_plan_clean_v1(
        p_session_token,
        v_shokry_import,
        'دواء شكري',
        'طلبية شكري — '||to_char(current_date,'YYYY-MM-DD'),
        coalesce((v_plan->'shokry'->'summary'->>'recommended_daily_budget')::numeric,0),
        0,
        0,
        v_shokry_items
      ) into v_shokry_result;

      if coalesce((v_shokry_result->>'ok')::boolean,false)=false then
        v_err:=coalesce(v_shokry_result->>'error','shokry_create_failed');
        raise exception 'DUAL_CREATE:%',v_err;
      end if;
      v_shokry_order:=(v_shokry_result->'data'->>'id')::uuid;
      v_shokry_expected_hash:=public.smart_purchase_plan_items_hash_v1(v_shokry_items);
      v_shokry_persisted_hash:=public.smart_purchase_order_items_hash_v1(v_shokry_order);
      if coalesce(v_shokry_expected_hash,'')<>coalesce(v_shokry_persisted_hash,'') then
        raise exception 'DUAL_CREATE:order_content_mismatch_shokry';
      end if;
    end if;

    if jsonb_array_length(v_shamy_items)>0 then
      select public.smart_purchase_create_order_from_plan_clean_v1(
        p_session_token,
        v_shamy_import,
        'دواء الشامي',
        'طلبية الشامي — '||to_char(current_date,'YYYY-MM-DD'),
        coalesce((v_plan->'shamy'->'summary'->>'recommended_daily_budget')::numeric,0),
        0,
        0,
        v_shamy_items
      ) into v_shamy_result;

      if coalesce((v_shamy_result->>'ok')::boolean,false)=false then
        v_err:=coalesce(v_shamy_result->>'error','shamy_create_failed');
        raise exception 'DUAL_CREATE:%',v_err;
      end if;
      v_shamy_order:=(v_shamy_result->'data'->>'id')::uuid;
      v_shamy_expected_hash:=public.smart_purchase_plan_items_hash_v1(v_shamy_items);
      v_shamy_persisted_hash:=public.smart_purchase_order_items_hash_v1(v_shamy_order);
      if coalesce(v_shamy_expected_hash,'')<>coalesce(v_shamy_persisted_hash,'') then
        raise exception 'DUAL_CREATE:order_content_mismatch_shamy';
      end if;
    end if;

    insert into public.smart_purchase_dual_plan_runs(
      plan_hash,stock_sync_id,shokry_order_id,shamy_order_id,
      shokry_items_hash,shamy_items_hash,
      created_by_account_id,created_by_name
    ) values(
      p_plan_hash,p_stock_sync_id,v_shokry_order,v_shamy_order,
      v_shokry_persisted_hash,v_shamy_persisted_hash,a.id,a.display_name
    );
  exception
    when others then
      raise log 'SMART_PURCHASE_DUAL_CREATE_FAILURE plan_hash=% stock_sync_id=% error=%', p_plan_hash, p_stock_sync_id, sqlerrm;
      if position('DUAL_CREATE:' in sqlerrm)>0 then
        return jsonb_build_object('ok',false,'error',split_part(sqlerrm,'DUAL_CREATE:',2));
      end if;
      return jsonb_build_object('ok',false,'error','dual_create_failed','detail',sqlerrm);
  end;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'already_created',false,
      'plan_hash',p_plan_hash,
      'stock_sync_id',p_stock_sync_id,
      'shokry_order_id',v_shokry_order,
      'shamy_order_id',v_shamy_order,
      'shokry_items_hash',v_shokry_persisted_hash,
      'shamy_items_hash',v_shamy_persisted_hash,
      'content_verified',true
    )
  );
end
$function$

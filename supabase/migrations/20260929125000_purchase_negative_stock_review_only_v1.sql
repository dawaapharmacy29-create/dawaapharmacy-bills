-- Negative stock balances are normalized to zero during parsing.
-- Keep their audit counters visible, but do not block dual draft creation.

CREATE OR REPLACE FUNCTION public.smart_purchase_dual_branch_instant_plan_v1(p_session_token text, p_shokry_budget numeric DEFAULT NULL::numeric, p_shamy_budget numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
 SET statement_timeout TO '20s'
AS $function$
declare
  a record;
  v_branch text;
  v_safe numeric:=0;
  v_financial_at timestamptz;
  v_capacity numeric:=0;
  v_min_value numeric:=0;
  v_reorder_value numeric:=0;
  v_max_value numeric:=0;
  v_mode text;
  v_budget numeric;
  v_result jsonb;
  v_shokry jsonb;
  v_shamy jsonb;
  v_modes jsonb:='{}'::jsonb;
  v_shokry_sync text;
  v_shamy_sync text;
  v_sync_id text;
  v_plan_hash text;
  v_review_watchlist jsonb;
  v_movement_watchlist jsonb;
  v_creation_guard jsonb;
  v_pending_summary jsonb;
  v_negative_shokry int:=0;
  v_negative_shamy int:=0;
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

  perform public.smart_purchase_refresh_movement_review_v1();

  select s.stock_sync_id
  into v_shokry_sync
  from public.purchase_branch_current_snapshots s
  where s.branch='دواء شكري'
    and coalesce(s.inventory_eligible,true)
    and s.stock_sync_id is not null
  order by s.stock_captured_at desc nulls last
  limit 1;

  select s.stock_sync_id
  into v_shamy_sync
  from public.purchase_branch_current_snapshots s
  where s.branch='دواء الشامي'
    and coalesce(s.inventory_eligible,true)
    and s.stock_sync_id is not null
  order by s.stock_captured_at desc nulls last
  limit 1;

  if coalesce(v_shokry_sync,'')=''
     or coalesce(v_shamy_sync,'')=''
     or v_shokry_sync<>v_shamy_sync then
    return jsonb_build_object(
      'ok',false,
      'error','stock_sync_mismatch',
      'data',jsonb_build_object(
        'shokry_sync',v_shokry_sync,
        'shamy_sync',v_shamy_sync
      )
    );
  end if;

  v_sync_id:=v_shokry_sync;

  select
    count(*) filter(where s.branch='دواء شكري' and coalesce((s.source_row->>'shokry_stock_negative')::boolean,false)),
    count(*) filter(where s.branch='دواء الشامي' and coalesce((s.source_row->>'shamy_stock_negative')::boolean,false))
  into v_negative_shokry,v_negative_shamy
  from public.purchase_branch_current_snapshots s
  where s.stock_sync_id=v_sync_id
    and s.branch in ('دواء شكري','دواء الشامي');

  foreach v_branch in array array['دواء شكري','دواء الشامي'] loop
    if not public.smart_purchase_branch_allowed_v2(a.id,v_branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch','data',jsonb_build_object('branch',v_branch));
    end if;

    select coalesce(d.safe_order_today,0),d.captured_at
    into v_safe,v_financial_at
    from public.purchase_decision_daily_snapshots d
    where d.branch=v_branch
    order by d.captured_at desc
    limit 1;

    v_budget:=case when v_branch='دواء شكري' then p_shokry_budget else p_shamy_budget end;

    v_capacity:=case
      when coalesce(v_budget,0)>0
           and v_financial_at is not null
           and now()-v_financial_at<=interval '12 hours'
           and v_safe>0
        then least(v_budget,v_safe)
      when coalesce(v_budget,0)>0 then v_budget
      when v_financial_at is not null
           and now()-v_financial_at<=interval '12 hours'
        then greatest(0,v_safe)
      else 0
    end;

    with active as (
      select
        p.branch,
        p.product_key,
        p.smart_min_stock,
        p.smart_reorder_point,
        p.smart_max_stock,
        greatest(0,coalesce(s.current_stock,0))
          + greatest(
              greatest(0,coalesce(s.pending_incoming,0)),
              greatest(0,coalesce(ep.pending_quantity,0))
            ) available,
        greatest(0,coalesce(s.unit_cost,0)) unit_cost
      from public.purchase_inventory_intelligence_profiles p
      join public.purchase_branch_current_snapshots s
        on s.branch=p.branch and s.product_key=p.product_key
      left join public.smart_purchase_executive_pending_incoming_v1 ep
        on ep.branch=s.branch and ep.product_key=s.product_key
      where p.inventory_policy_model_version='adaptive_pack_minmax_v1'
        and coalesce(s.inventory_eligible,true)
    ),
    target as (
      select *
      from active
      where branch=v_branch
    ),
    source as (
      select
        product_key,
        greatest(0,available-smart_max_stock) source_surplus
      from active
      where branch<>v_branch
    ),
    net as (
      select
        t.*,
        coalesce(src.source_surplus,0) source_surplus,
        greatest(0,greatest(0,t.smart_min_stock-t.available)-coalesce(src.source_surplus,0)) need_min_external,
        greatest(0,greatest(0,t.smart_reorder_point-t.available)-coalesce(src.source_surplus,0)) need_reorder_external,
        greatest(0,greatest(0,t.smart_max_stock-t.available)-coalesce(src.source_surplus,0)) need_max_external
      from target t
      left join source src on src.product_key=t.product_key
    )
    select
      coalesce(sum(need_min_external*unit_cost),0),
      coalesce(sum(need_reorder_external*unit_cost),0),
      coalesce(sum(need_max_external*unit_cost),0)
    into v_min_value,v_reorder_value,v_max_value
    from net;

    v_mode:=case
      when v_capacity<=0 then 'critical'
      when v_capacity<v_reorder_value then 'critical'
      when v_capacity<v_max_value then 'medium'
      else 'comfortable'
    end;

    select public.smart_purchase_demand_transfer_preview_v10(
      p_session_token,
      v_branch,
      v_mode,
      v_budget
    )
    into v_result;

    if coalesce((v_result->>'ok')::boolean,false)=false then
      return v_result;
    end if;

    v_modes:=v_modes || jsonb_build_object(
      v_branch,
      jsonb_build_object(
        'mode',v_mode,
        'decision_capacity',round(v_capacity,2),
        'safe_order_today',round(v_safe,2),
        'financial_snapshot_at',v_financial_at,
        'financial_snapshot_fresh',(v_financial_at is not null and now()-v_financial_at<=interval '12 hours'),
        'need_to_min',round(v_min_value,2),
        'need_to_reorder',round(v_reorder_value,2),
        'need_to_max',round(v_max_value,2)
      )
    );

    if v_branch='دواء شكري' then
      v_shokry:=v_result->'data';
    else
      v_shamy:=v_result->'data';
    end if;
  end loop;

  v_review_watchlist:=jsonb_build_object(
    'shokry',public.smart_purchase_review_watchlist_clean_v1('دواء شكري',25),
    'shamy',public.smart_purchase_review_watchlist_clean_v1('دواء الشامي',25)
  );

  v_movement_watchlist:=jsonb_build_object(
    'shokry',public.smart_purchase_movement_watchlist_clean_v1('دواء شكري',15),
    'shamy',public.smart_purchase_movement_watchlist_clean_v1('دواء الشامي',15)
  );

  select jsonb_build_object(
    'shokry',jsonb_build_object(
      'items',count(*) filter(where ep.branch='دواء شكري'),
      'units',round(coalesce(sum(ep.pending_quantity) filter(where ep.branch='دواء شكري'),0),2),
      'last_sent_at',max(ep.last_sent_at) filter(where ep.branch='دواء شكري')
    ),
    'shamy',jsonb_build_object(
      'items',count(*) filter(where ep.branch='دواء الشامي'),
      'units',round(coalesce(sum(ep.pending_quantity) filter(where ep.branch='دواء الشامي'),0),2),
      'last_sent_at',max(ep.last_sent_at) filter(where ep.branch='دواء الشامي')
    )
  )
  into v_pending_summary
  from public.smart_purchase_executive_pending_incoming_v1 ep;

  v_creation_guard:=jsonb_build_object(
    'shokry_open_order',public.smart_purchase_branch_has_blocking_order_clean_v1('دواء شكري'),
    'shamy_open_order',public.smart_purchase_branch_has_blocking_order_clean_v1('دواء الشامي'),
    'shokry_data_ready',coalesce((v_shokry->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false),
    'shamy_data_ready',coalesce((v_shamy->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false),
    'stock_quality',jsonb_build_object(
      'negative_shokry',v_negative_shokry,
      'negative_shamy',v_negative_shamy,
      'ok',(v_negative_shokry=0 and v_negative_shamy=0)
    ),
    'can_create_dual',
      not public.smart_purchase_branch_has_blocking_order_clean_v1('دواء شكري')
      and not public.smart_purchase_branch_has_blocking_order_clean_v1('دواء الشامي')
      and coalesce((v_shokry->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false)
      and coalesce((v_shamy->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false),
    'shokry_open_orders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'status',o.status,
        'created_at',o.created_at,
        'title',o.title
      ) order by o.created_at desc)
      from public.smart_purchase_orders o
      where o.branch='دواء شكري'
        and coalesce(o.status,'') not in (
          'ملغاة','cancelled','canceled','مغلقة','closed',
          'وصلت بالكامل','received','تمت مطابقة الفاتورة','matched'
        )
        and (
          (
            o.created_at>=now()-interval '30 days'
            and o.status in (
              'draft','مسودة','تم التحليل','معتمدة','approved',
              'تم الإرسال للمورد','sent','وصلت جزئيًا','partially_received'
            )
          )
          or (
            exists(
              select 1 from public.purchase_order_supplier_dispatches d
              where d.order_id=o.id and d.sent_at is not null
            )
            and exists(
              select 1 from public.smart_purchase_order_items i
              where i.order_id=o.id
                and greatest(0,coalesce(i.approved_quantity,0)-coalesce(i.received_quantity,0))>0
            )
          )
          or exists(
            select 1 from public.purchase_order_receipts r
            where r.order_id=o.id and coalesce(r.cumulative_remaining_quantity,0)>0
          )
        )
    ),'[]'::jsonb),
    'shamy_open_orders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'status',o.status,
        'created_at',o.created_at,
        'title',o.title
      ) order by o.created_at desc)
      from public.smart_purchase_orders o
      where o.branch='دواء الشامي'
        and coalesce(o.status,'') not in (
          'ملغاة','cancelled','canceled','مغلقة','closed',
          'وصلت بالكامل','received','تمت مطابقة الفاتورة','matched'
        )
        and (
          (
            o.created_at>=now()-interval '30 days'
            and o.status in (
              'draft','مسودة','تم التحليل','معتمدة','approved',
              'تم الإرسال للمورد','sent','وصلت جزئيًا','partially_received'
            )
          )
          or (
            exists(
              select 1 from public.purchase_order_supplier_dispatches d
              where d.order_id=o.id and d.sent_at is not null
            )
            and exists(
              select 1 from public.smart_purchase_order_items i
              where i.order_id=o.id
                and greatest(0,coalesce(i.approved_quantity,0)-coalesce(i.received_quantity,0))>0
            )
          )
          or exists(
            select 1 from public.purchase_order_receipts r
            where r.order_id=o.id and coalesce(r.cumulative_remaining_quantity,0)>0
          )
        )
    ),'[]'::jsonb),
    'legacy_stale_orders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'branch',o.branch,
        'status',o.status,
        'created_at',o.created_at,
        'title',o.title
      ) order by o.created_at desc)
      from public.smart_purchase_orders o
      where coalesce(o.status,'') not in (
        'ملغاة','cancelled','canceled','مغلقة','closed',
        'وصلت بالكامل','received','تمت مطابقة الفاتورة','matched'
      )
        and o.created_at<now()-interval '30 days'
        and not exists(
          select 1 from public.purchase_order_supplier_dispatches d
          where d.order_id=o.id and d.sent_at is not null
        )
        and not exists(select 1 from public.purchase_order_receipts r where r.order_id=o.id)
        and not exists(select 1 from public.smart_purchase_receipt_facts rf where rf.order_id=o.id)
    ),'[]'::jsonb)
  );

  v_plan_hash:=encode(
    extensions.digest(
      convert_to(
        coalesce(v_sync_id,'')||'|'||
        coalesce(v_modes::text,'{}')||'|'||
        coalesce(v_shokry::text,'{}')||'|'||
        coalesce(v_shamy::text,'{}'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'planner','dual_branch_instant_plan_v1',
      'stock_sync_id',v_sync_id,
      'plan_hash',v_plan_hash,
      'generated_at',now(),
      'modes',v_modes,
      'shokry',v_shokry,
      'shamy',v_shamy,
      'execution_pending',v_pending_summary,
      'review_watchlist',v_review_watchlist,
      'movement_only_watchlist',v_movement_watchlist,
      'creation_guard',v_creation_guard,
      'totals',jsonb_build_object(
        'buy_value',
          round(
            coalesce((v_shokry->'summary'->>'suggested_buy_value')::numeric,0)
            + coalesce((v_shamy->'summary'->>'suggested_buy_value')::numeric,0)
          ,2),
        'buy_items',
          coalesce((v_shokry->'summary'->>'buy_now_items')::int,0)
          + coalesce((v_shamy->'summary'->>'buy_now_items')::int,0),
        'transfer_items',
          coalesce((v_shokry->'summary'->>'transfer_only_items')::int,0)
          + coalesce((v_shokry->'summary'->>'transfer_then_buy_items')::int,0)
          + coalesce((v_shamy->'summary'->>'transfer_only_items')::int,0)
          + coalesce((v_shamy->'summary'->>'transfer_then_buy_items')::int,0),
        'quick_review_items',
          coalesce((v_shokry->'summary'->>'quick_review_items')::int,0)
          + coalesce((v_shamy->'summary'->>'quick_review_items')::int,0)
      )
    )
  );
end
$function$

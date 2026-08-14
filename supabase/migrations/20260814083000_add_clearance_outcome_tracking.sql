create table if not exists public.purchase_clearance_plan_runs (
  id uuid primary key default gen_random_uuid(), branch text not null, generated_at timestamptz not null default now(),
  created_by uuid references public.staff_accounts(id) on delete set null, created_by_name text,
  summary jsonb not null default '{}'::jsonb
);

create table if not exists public.purchase_clearance_plan_items (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.purchase_clearance_plan_runs(id) on delete cascade,
  batch_id uuid references public.purchase_inventory_batches(id) on delete set null,
  branch text not null, product_code text, product_name text not null, batch_number text,
  expiry_date date, starting_quantity numeric not null default 0, unit_cost numeric not null default 0,
  units_to_act numeric not null default 0, suggested_transfer_units numeric not null default 0,
  daily_clearance_target numeric not null default 0, action_code text, capital_at_risk numeric not null default 0,
  observed_current_quantity numeric, observed_reduction numeric not null default 0,
  avoided_risk_units numeric not null default 0, avoided_loss_value numeric not null default 0,
  completion_percent numeric not null default 0, last_evaluated_at timestamptz,
  unique(run_id,batch_id)
);
create index if not exists idx_clearance_plan_runs_branch_date on public.purchase_clearance_plan_runs(branch,generated_at desc);
create index if not exists idx_clearance_plan_items_batch on public.purchase_clearance_plan_items(batch_id);

create table if not exists public.purchase_inventory_batch_history (
  id bigserial primary key, batch_id uuid not null, branch text not null, product_name text not null, batch_number text,
  expiry_date date, quantity numeric not null, unit_cost numeric not null default 0, captured_at timestamptz not null default now()
);
create index if not exists idx_purchase_inventory_batch_history on public.purchase_inventory_batch_history(batch_id,captured_at desc);

create or replace function public.purchase_inventory_batch_history_capture() returns trigger
language plpgsql set search_path to 'pg_catalog','public' as $$
begin
  if tg_op='INSERT' or new.quantity is distinct from old.quantity then
    insert into public.purchase_inventory_batch_history(batch_id,branch,product_name,batch_number,expiry_date,quantity,unit_cost)
    values(new.id,new.branch,new.product_name,new.batch_number,new.expiry_date,new.quantity,new.unit_cost);
  end if;
  return new;
end;$$;
drop trigger if exists trg_purchase_inventory_batch_history on public.purchase_inventory_batches;
create trigger trg_purchase_inventory_batch_history after insert or update of quantity on public.purchase_inventory_batches
for each row execute function public.purchase_inventory_batch_history_capture();

create or replace function public.smart_purchase_clearance_capture_plan_v1(p_session_token text,p_branch text default 'all') returns jsonb
language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare a record; v jsonb; runid uuid; item jsonb; cnt int:=0;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  v:=public.smart_purchase_clearance_engine_v1(p_session_token,p_branch);
  if coalesce((v->>'ok')::boolean,false)=false then return v; end if;
  insert into public.purchase_clearance_plan_runs(branch,created_by,created_by_name,summary) values(coalesce(p_branch,'all'),a.id,a.display_name,coalesce(v->'summary','{}'::jsonb)) returning id into runid;
  for item in select value from jsonb_array_elements(coalesce(v->'plan','[]'::jsonb)) loop
    if coalesce((item->>'units_to_act')::numeric,0)<=0 and coalesce((item->>'days_to_expiry')::int,0)>=0 then continue; end if;
    insert into public.purchase_clearance_plan_items(run_id,batch_id,branch,product_code,product_name,batch_number,expiry_date,starting_quantity,unit_cost,units_to_act,suggested_transfer_units,daily_clearance_target,action_code,capital_at_risk)
    values(runid,nullif(item->>'batch_id','')::uuid,item->>'branch',item->>'product_code',item->>'product_name',item->>'batch_number',nullif(item->>'expiry_date','')::date,
      coalesce((item->>'batch_quantity')::numeric,0),coalesce((item->>'unit_cost')::numeric,0),coalesce((item->>'units_to_act')::numeric,0),coalesce((item->>'suggested_transfer_units')::numeric,0),coalesce((item->>'daily_clearance_target')::numeric,0),item->>'action_code',coalesce((item->>'capital_at_risk')::numeric,0));
    cnt:=cnt+1;
  end loop;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('run_id',runid,'tracked_items',cnt));
end;$$;

grant execute on function public.smart_purchase_clearance_capture_plan_v1(text,text) to anon,authenticated;

create or replace function public.smart_purchase_clearance_outcomes_v1(p_session_token text,p_branch text default 'all') returns jsonb
language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare a record; outj jsonb;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  update public.purchase_clearance_plan_items i set
    observed_current_quantity=coalesce(b.quantity,0),
    observed_reduction=greatest(0,i.starting_quantity-coalesce(b.quantity,0)),
    avoided_risk_units=least(i.units_to_act,greatest(0,i.starting_quantity-coalesce(b.quantity,0))),
    avoided_loss_value=round((least(i.units_to_act,greatest(0,i.starting_quantity-coalesce(b.quantity,0)))*i.unit_cost)::numeric,2),
    completion_percent=case when i.units_to_act>0 then least(100,round((greatest(0,i.starting_quantity-coalesce(b.quantity,0))/i.units_to_act*100)::numeric,1)) else 100 end,
    last_evaluated_at=now()
  from public.purchase_inventory_batches b join public.purchase_clearance_plan_runs r on r.id=i.run_id
  where b.id=i.batch_id and (coalesce(p_branch,'all')='all' or i.branch=p_branch)
    and (a.role<>'branch_manager' or coalesce(a.branch_ids,'[]'::jsonb)?i.branch or coalesce(a.branch_ids,'[]'::jsonb)?replace(i.branch,'دواء ','') or coalesce(a.branch_ids,'[]'::jsonb)?replace(i.branch,'فرع ',''));

  with x as (
    select i.*,r.generated_at from public.purchase_clearance_plan_items i join public.purchase_clearance_plan_runs r on r.id=i.run_id
    where (coalesce(p_branch,'all')='all' or i.branch=p_branch)
      and (a.role<>'branch_manager' or coalesce(a.branch_ids,'[]'::jsonb)?i.branch or coalesce(a.branch_ids,'[]'::jsonb)?replace(i.branch,'دواء ','') or coalesce(a.branch_ids,'[]'::jsonb)?replace(i.branch,'فرع ',''))
      and r.generated_at>=now()-interval '90 days'
  )
  select jsonb_build_object(
    'ok',true,
    'summary',jsonb_build_object(
      'tracked_actions',count(*),'planned_risk_value',round(coalesce(sum(capital_at_risk),0)::numeric,2),
      'avoided_loss_value',round(coalesce(sum(avoided_loss_value),0)::numeric,2),'avoided_risk_units',coalesce(sum(avoided_risk_units),0),
      'observed_reduction_units',coalesce(sum(observed_reduction),0),
      'success_percent',case when sum(capital_at_risk)>0 then round((sum(avoided_loss_value)/sum(capital_at_risk)*100)::numeric,1) else 0 end
    ),
    'items',coalesce(jsonb_agg(jsonb_build_object('branch',branch,'product_name',product_name,'batch_number',batch_number,'expiry_date',expiry_date,'generated_at',generated_at,
      'starting_quantity',starting_quantity,'current_quantity',observed_current_quantity,'units_to_act',units_to_act,'observed_reduction',observed_reduction,
      'avoided_risk_units',avoided_risk_units,'capital_at_risk',capital_at_risk,'avoided_loss_value',avoided_loss_value,'completion_percent',completion_percent,'action_code',action_code)
      order by generated_at desc,capital_at_risk desc),'[]'::jsonb)
  ) into outj from x;
  return outj;
end;$$;

grant execute on function public.smart_purchase_clearance_outcomes_v1(text,text) to anon,authenticated;
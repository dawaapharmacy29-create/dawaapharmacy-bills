create table if not exists public.smart_purchase_workflow_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  workflow_type text not null check (workflow_type in ('supplier_response', 'receipt')),
  response_type text null,
  supplier_name text null,
  file_name text null,
  summary jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_smart_purchase_workflow_snapshots_order
  on public.smart_purchase_workflow_snapshots(order_id, created_at desc);

alter table public.smart_purchase_workflow_snapshots enable row level security;

create or replace function public.smart_purchase_save_workflow_snapshot(
  p_session_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth jsonb;
  v_id uuid;
  v_order_id uuid;
  v_workflow_type text;
begin
  if coalesce(trim(p_session_token), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select public.smart_purchase_unified(
    p_session_token,
    'dashboard',
    '{}'::jsonb
  ) into v_auth;

  if coalesce((v_auth->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_auth->>'error', 'invalid_session'),
      'message', coalesce(v_auth->>'message', 'تعذر التحقق من الجلسة.')
    );
  end if;

  v_order_id := nullif(p_payload->>'order_id', '')::uuid;
  v_workflow_type := nullif(trim(p_payload->>'workflow_type'), '');

  if v_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_order');
  end if;
  if v_workflow_type not in ('supplier_response', 'receipt') then
    return jsonb_build_object('ok', false, 'error', 'invalid_workflow_type');
  end if;

  insert into public.smart_purchase_workflow_snapshots (
    order_id,
    workflow_type,
    response_type,
    supplier_name,
    file_name,
    summary,
    details
  ) values (
    v_order_id,
    v_workflow_type,
    nullif(trim(p_payload->>'response_type'), ''),
    nullif(trim(p_payload->>'supplier_name'), ''),
    nullif(trim(p_payload->>'file_name'), ''),
    coalesce(p_payload->'summary', '{}'::jsonb),
    coalesce(p_payload->'details', '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object('id', v_id, 'order_id', v_order_id)
  );
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'save_failed',
    'message', sqlerrm
  );
end;
$$;

grant execute on function public.smart_purchase_save_workflow_snapshot(text, jsonb)
to anon, authenticated;

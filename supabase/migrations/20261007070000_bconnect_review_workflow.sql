-- B-Connect review workflow proposal. NOT applied to production by this migration commit alone.
-- Goals: server-side global duplicate gate, atomic batch review/approval, preserve existing workflow/audit rules.

create or replace function public.app_bconnect_invoice_number_check(
  p_session_token text,
  p_numbers text[]
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare v_account public.staff_accounts%rowtype; v_rows jsonb;
begin
  select a.* into v_account from public.staff_sessions s join public.staff_accounts a on a.id=s.account_id
  where s.token_hash=encode(digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>now() and a.status='active'
  order by s.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows
  from (
    select trim(p.system_invoice_number) system_invoice_number,
           count(*)::int record_count,
           array_agg(p.id order by p.created_at) invoice_ids
    from public.purchase_invoices p
    where coalesce(p.is_sample,false)=false
      and coalesce(p.base44_sync_state,'active')='active'
      and trim(coalesce(p.system_invoice_number,'')) = any(coalesce(p_numbers,array[]::text[]))
      and (v_account.role='general_manager' or p.branch in (select jsonb_array_elements_text(coalesce(v_account.branch_ids,'[]'::jsonb))))
    group by trim(p.system_invoice_number)
  ) x;
  return jsonb_build_object('ok',true,'data',v_rows);
end; $$;

revoke all on function public.app_bconnect_invoice_number_check(text,text[]) from public;
grant execute on function public.app_bconnect_invoice_number_check(text,text[]) to anon,authenticated,service_role;

create or replace function public.app_bconnect_bulk_workflow(
  p_session_token text,
  p_items jsonb,
  p_note text default 'B-Connect verified batch'
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_account public.staff_accounts%rowtype; v_item jsonb; v_invoice public.purchase_invoices%rowtype;
  v_number text; v_id text; v_count int; v_now timestamptz:=now(); v_results jsonb:='[]'::jsonb;
  v_expected_branch text; v_expected_total numeric; v_seen_numbers text[]:=array[]::text[];
  v_from text;
begin
  select a.* into v_account from public.staff_sessions s join public.staff_accounts a on a.id=s.account_id
  where s.token_hash=encode(digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>v_now and a.status='active'
  order by s.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','invoice_reviewer','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>500 then
    return jsonb_build_object('ok',false,'error','invalid_batch');
  end if;

  -- Serialize competing B-Connect batches so a number cannot pass two checks concurrently.
  perform pg_advisory_xact_lock(hashtext('app_bconnect_bulk_workflow'));

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_id:=nullif(trim(v_item->>'invoice_id'),''); v_number:=nullif(trim(v_item->>'system_invoice_number'),'');
    v_expected_branch:=nullif(trim(v_item->>'expected_branch'),'');
    begin v_expected_total:=(v_item->>'expected_total_value')::numeric; exception when others then v_expected_total:=null; end;
    if v_id is null or v_number is null or v_expected_branch is null or v_expected_total is null then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('invoice_id',v_id,'number',v_number,'ok',false,'error','missing_snapshot')); continue;
    end if;
    if v_number=any(v_seen_numbers) then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('invoice_id',v_id,'number',v_number,'ok',false,'error','duplicate_in_batch')); continue;
    end if;
    v_seen_numbers:=array_append(v_seen_numbers,v_number);
    select count(*) into v_count from public.purchase_invoices p
      where coalesce(p.is_sample,false)=false and coalesce(p.base44_sync_state,'active')='active'
        and trim(coalesce(p.system_invoice_number,''))=v_number;
    if v_count<>1 then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('invoice_id',v_id,'number',v_number,'ok',false,'error','duplicate_or_missing_number','record_count',v_count)); continue;
    end if;
    select * into v_invoice from public.purchase_invoices where id=v_id for update;
    if not found or trim(coalesce(v_invoice.system_invoice_number,''))<>v_number then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('invoice_id',v_id,'number',v_number,'ok',false,'error','invoice_changed')); continue;
    end if;
    if v_invoice.branch is distinct from v_expected_branch or round(coalesce(v_invoice.total_value,0)::numeric,3)<>round(v_expected_total,3) then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('invoice_id',v_id,'number',v_number,'ok',false,'error','snapshot_changed')); continue;
    end if;
    if v_account.role<>'general_manager' and not (coalesce(v_account.branch_ids,'[]'::jsonb) ? v_invoice.branch) then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('invoice_id',v_id,'number',v_number,'ok',false,'error','forbidden_branch')); continue;
    end if;

    v_from:=public.purchase_invoice_canonical_status(v_invoice.workflow_status,v_invoice.status);
    if v_from='submitted' and v_account.role in ('general_manager','branch_manager','invoice_reviewer') then
      update public.purchase_invoices set workflow_status='reviewed',status='تمت المراجعة',
        reviewed_by_account_id=v_account.id,reviewed_by_name=v_account.display_name,reviewed_at=v_now,
        review_note=p_note,updated_at=v_now where id=v_id;
      insert into public.invoice_workflow_events(invoice_id,action,from_status,to_status,note,actor_account_id,actor_username,actor_display_name,actor_role)
      values(v_id,'review','submitted','reviewed',p_note,v_account.id,v_account.username,v_account.display_name,v_account.role);
      v_from:='reviewed';
    end if;
    if v_from='reviewed' and v_account.role in ('general_manager','accountant') then
      update public.purchase_invoices set workflow_status='approved',status='معتمدة',
        approved_by_account_id=v_account.id,approved_by_name=v_account.display_name,approved_at=v_now,updated_at=v_now where id=v_id;
      insert into public.invoice_workflow_events(invoice_id,action,from_status,to_status,note,actor_account_id,actor_username,actor_display_name,actor_role)
      values(v_id,'approve','reviewed','approved',p_note,v_account.id,v_account.username,v_account.display_name,v_account.role);
      v_from:='approved';
    end if;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('invoice_id',v_id,'number',v_number,'ok',true,'to_status',v_from));
  end loop;
  return jsonb_build_object('ok',true,'data',v_results);
end; $$;

revoke all on function public.app_bconnect_bulk_workflow(text,jsonb,text) from public;
grant execute on function public.app_bconnect_bulk_workflow(text,jsonb,text) to anon,authenticated,service_role;

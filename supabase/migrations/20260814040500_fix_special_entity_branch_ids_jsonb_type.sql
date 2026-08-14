-- Fix app_special_entity_action failing with:
-- COALESCE types jsonb and text[] cannot be matched
-- staff_accounts.branch_ids is jsonb, while the RPC previously treated it as text[].

do $$
declare
  v_oid oid;
  v_def text;
  v_old text := 'v_allowed := case when v_account.role=''general_manager'' then null else coalesce(v_account.branch_ids,array[]::text[]) end;';
  v_new text := 'if v_account.role=''general_manager'' then
    v_allowed := null;
  else
    select coalesce(array_agg(j.value), array[]::text[])
      into v_allowed
    from jsonb_array_elements_text(coalesce(v_account.branch_ids, ''[]''::jsonb)) as j(value);
  end if;';
begin
  select p.oid
    into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'app_special_entity_action'
    and pg_get_function_identity_arguments(p.oid) = 'p_session_token text, p_entity text, p_action text, p_id text, p_data jsonb'
  limit 1;

  if v_oid is null then
    raise exception 'app_special_entity_action not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if position(v_old in v_def) = 0 then
    -- Production may already have the corrected form. Treat that as idempotent.
    if position('jsonb_array_elements_text(coalesce(v_account.branch_ids, ''[]''::jsonb))' in v_def) > 0 then
      return;
    end if;
    raise exception 'expected branch_ids expression not found; migration aborted safely';
  end if;

  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$$;

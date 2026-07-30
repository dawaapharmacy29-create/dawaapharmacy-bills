-- Admin-facing visibility into the Base44 -> Supabase reconciliation queue.
--
-- The reconciliation engine (20260728_base44_reconciliation_engine.sql) already
-- classifies incoming Base44 events into public.base44_reconciliation_reviews
-- with review_status = 'pending' for financial records (ShiftDelivery,
-- SupplierPayment, PurchaseInvoice, ...). Nothing in the app could see that
-- queue before this migration, so it could grow silently with no way for
-- an admin to know what still needs attention.
--
-- These two functions are intentionally READ + STATUS-TRACKING ONLY:
-- app_base44_review_mark never writes to any production table (Supplier,
-- PurchaseInvoice, ShiftDelivery, etc.) — it only records that an admin has
-- looked at a given review row and what they decided to do about it manually.
-- Actually applying a reviewed record into production data is a separate,
-- deliberately out-of-scope decision that still needs its own careful,
-- entity-by-entity migration once you're ready for it.

create or replace function public.app_base44_pending_reviews_list(
  p_session_token text,
  p_status text default 'pending',
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
  v_rows jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  select a.role
    into v_role
  from public.staff_sessions s
  join public.staff_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and a.status = 'active'
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  if v_role <> 'general_manager' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.staff_sessions
     set last_seen_at = now()
   where token_hash = encode(digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
     and revoked_at is null;

  select coalesce(jsonb_agg(to_jsonb(x) order by
      case x.risk_level when 'high' then 0 when 'elevated' then 1 else 2 end,
      x.created_at desc
    ), '[]'::jsonb)
    into v_rows
  from (
    select r.*
    from public.base44_reconciliation_reviews r
    where p_status is null or p_status = 'all' or r.review_status = p_status
    order by
      case r.risk_level when 'high' then 0 when 'elevated' then 1 else 2 end,
      r.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'rows', coalesce(v_rows, '[]'::jsonb),
      'count', jsonb_array_length(coalesce(v_rows, '[]'::jsonb)),
      'pending_total', (select count(*) from public.base44_reconciliation_reviews where review_status = 'pending')
    )
  );
end;
$$;

revoke all on function public.app_base44_pending_reviews_list(text,text,integer) from public;
grant execute on function public.app_base44_pending_reviews_list(text,text,integer) to anon, authenticated;

create or replace function public.app_base44_review_mark(
  p_session_token text,
  p_review_id uuid,
  p_decision text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
  v_account_label text;
begin
  select a.role, coalesce(a.display_name, a.username)
    into v_role, v_account_label
  from public.staff_sessions s
  join public.staff_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and a.status = 'active'
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  if v_role <> 'general_manager' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_decision not in ('acknowledged', 'needs_manual_apply', 'dismissed') then
    return jsonb_build_object('ok', false, 'error', 'invalid_decision');
  end if;

  update public.base44_reconciliation_reviews
     set review_status = p_decision,
         review_notes = case when p_notes is not null and length(trim(p_notes)) > 0
                              then trim(p_notes) || ' — ' || coalesce(v_account_label, 'admin')
                              else review_notes end,
         reviewed_at = now()
   where id = p_review_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.app_base44_review_mark(text,uuid,text,text) from public;
grant execute on function public.app_base44_review_mark(text,uuid,text,text) to anon, authenticated;

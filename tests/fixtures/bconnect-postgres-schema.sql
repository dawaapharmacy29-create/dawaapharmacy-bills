-- Synthetic schema for free PostgreSQL CI integration tests ONLY.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Supabase provides these roles; recreate only inside disposable vanilla PostgreSQL.
DO $ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $;
CREATE TABLE public.staff_accounts (
  id uuid PRIMARY KEY,
  username text,
  display_name text,
  role text,
  branch_ids jsonb,
  status text
);
CREATE TABLE public.staff_sessions (
  account_id uuid,
  token_hash text,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.purchase_invoices (
  id text PRIMARY KEY,
  system_invoice_number text,
  is_sample boolean DEFAULT false,
  notes text,
  branch text,
  workflow_status text,
  entered_by_account_id uuid,
  base44_sync_state text
);
CREATE OR REPLACE FUNCTION public.validate_staff_session(p_session_token text)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT coalesce((
   SELECT jsonb_build_object('ok',true,'account',jsonb_build_object(
     'id',a.id,'role',a.role,'branch_ids',a.branch_ids))
   FROM public.staff_sessions s JOIN public.staff_accounts a ON a.id=s.account_id
   WHERE s.token_hash=encode(digest(p_session_token,'sha256'),'hex')
     AND s.revoked_at IS NULL AND s.expires_at>now() AND a.status='active'
   LIMIT 1
 ),'{"ok":false}'::jsonb)
$$;
INSERT INTO public.staff_accounts(id,username,display_name,role,branch_ids,status)
VALUES ('11111111-1111-4111-8111-111111111111','fixture','Fixture','general_manager','["دواء شكري"]','active');
INSERT INTO public.staff_sessions(account_id,token_hash,expires_at)
VALUES ('11111111-1111-4111-8111-111111111111',
 encode(digest('fixture-token-only','sha256'),'hex'),now()+interval '1 hour');
INSERT INTO public.purchase_invoices(id,system_invoice_number,notes,branch,workflow_status,entered_by_account_id,base44_sync_state)
VALUES ('fixture-invoice-1','10001','original','دواء شكري','draft','11111111-1111-4111-8111-111111111111','active');

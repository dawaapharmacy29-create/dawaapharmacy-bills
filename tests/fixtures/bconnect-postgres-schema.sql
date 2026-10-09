-- Synthetic schema for free PostgreSQL CI integration tests ONLY.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $fixture_roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $fixture_roles$;

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
CREATE TABLE public.suppliers (
  id text PRIMARY KEY,
  name text NOT NULL,
  is_sample boolean NOT NULL DEFAULT false
);
CREATE TABLE public.purchase_invoices (
  id text PRIMARY KEY,
  system_invoice_number text,
  supplier_invoice_number text,
  is_sample boolean DEFAULT false,
  notes text,
  supplier_name text,
  supplier_id text,
  invoice_date date,
  total_value numeric NOT NULL DEFAULT 0,
  cash_amount numeric,
  returned_value numeric,
  branch text,
  payment_type text,
  purchase_category text,
  purchase_category_source text,
  transaction_type text,
  net_purchase_mode text,
  exclusion_reason text,
  exclusion_note text,
  source_branch text,
  destination_branch text,
  workflow_status text,
  entered_by_account_id uuid,
  base44_sync_state text,
  updated_at timestamptz NOT NULL DEFAULT now()
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

INSERT INTO public.suppliers(id,name,is_sample) VALUES
 ('supplier-1','مورد تجريبي',false),
 ('supplier-2','مورد بديل',false),
 ('supplier-sample','مورد عينة',true);

INSERT INTO public.staff_accounts(id,username,display_name,role,branch_ids,status)
VALUES ('11111111-1111-4111-8111-111111111111','fixture','Fixture','general_manager','["دواء شكري"]','active');
INSERT INTO public.staff_sessions(account_id,token_hash,expires_at)
VALUES ('11111111-1111-4111-8111-111111111111',
 encode(digest('fixture-token-only','sha256'),'hex'),now()+interval '1 hour');
INSERT INTO public.purchase_invoices(
 id,system_invoice_number,notes,branch,workflow_status,entered_by_account_id,base44_sync_state,
 supplier_id,supplier_name,invoice_date,total_value,returned_value,cash_amount,payment_type,purchase_category)
VALUES ('fixture-invoice-1','10001','original','دواء شكري','draft','11111111-1111-4111-8111-111111111111','active',
 'supplier-1','مورد تجريبي','2026-10-01',100,10,20,'آجل','medicines');

-- Non-manager synthetic accounts for permission and ownership coverage.
INSERT INTO public.staff_accounts(id,username,display_name,role,branch_ids,status)
VALUES
 ('22222222-2222-4222-8222-222222222222','fixture_entry','Fixture Entry','invoice_entry','["دواء شكري"]','active'),
 ('33333333-3333-4333-8333-333333333333','fixture_other','Fixture Other','invoice_entry','["دواء الشامي"]','active'),
 ('44444444-4444-4444-8444-444444444444','fixture_viewer','Fixture Viewer','viewer','["دواء شكري"]','active');
INSERT INTO public.staff_sessions(account_id,token_hash,expires_at)
VALUES
 ('22222222-2222-4222-8222-222222222222',encode(digest('fixture-entry-token','sha256'),'hex'),now()+interval '1 hour'),
 ('33333333-3333-4333-8333-333333333333',encode(digest('fixture-other-token','sha256'),'hex'),now()+interval '1 hour'),
 ('44444444-4444-4444-8444-444444444444',encode(digest('fixture-viewer-token','sha256'),'hex'),now()+interval '1 hour');
INSERT INTO public.purchase_invoices(
 id,system_invoice_number,notes,branch,workflow_status,entered_by_account_id,base44_sync_state,
 supplier_id,supplier_name,invoice_date,total_value,returned_value,cash_amount)
VALUES
 ('fixture-owned-draft','10002','owned original','دواء شكري','draft','22222222-2222-4222-8222-222222222222','active','supplier-1','مورد تجريبي','2026-10-02',120,0,0),
 ('fixture-approved','10003','approved original','دواء شكري','approved','22222222-2222-4222-8222-222222222222','active','supplier-1','مورد تجريبي','2026-10-03',130,0,0),
 ('fixture-source-pending','10004','pending original','دواء شكري','draft','22222222-2222-4222-8222-222222222222','pending_delete_review','supplier-1','مورد تجريبي','2026-10-04',140,0,0);

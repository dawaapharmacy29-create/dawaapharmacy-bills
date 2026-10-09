-- STAGING-ONLY PROTOTYPE. DO NOT APPLY TO PRODUCTION.
-- Approved policy: invoice numbers are unique WITHIN each branch, not globally.
-- No unique index is installed until legacy same-branch collisions and writer compatibility are verified.
-- Run in a disposable database after reconciling fixture collisions.
BEGIN;

DO $$
BEGIN
  IF current_setting('app.bconnect_staging_approved', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'staging_approval_required';
  END IF;
END $$;

-- Normalization mirrors the B-Connect number lookup; blank and zero-only values
-- are not eligible for the new write path.
CREATE OR REPLACE FUNCTION public.bconnect_canonical_invoice_number_v1(p_number text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN btrim(p_number) ~ '^[0-9]+[.]0+$'
    THEN split_part(btrim(p_number), '.', 1)
    ELSE btrim(p_number) END
$$;

-- Approved branch-scoped uniqueness policy. No index is applied here.
-- Legacy same-branch collisions must be reviewed before enabling enforcement.
-- Proposed eventual index (NOT EXECUTED):
-- CREATE UNIQUE INDEX CONCURRENTLY bconnect_branch_invoice_number_v1_idx
--   ON public.purchase_invoices
--   (branch, public.bconnect_canonical_invoice_number_v1(system_invoice_number))
--   WHERE system_invoice_number IS NOT NULL
--     AND btrim(system_invoice_number) <> ''
--     AND COALESCE(is_sample,false)=false;
-- CAUTION: normalize and validate branch identity before using this index;
-- legacy writers and nullable/alias branch values require separate handling.

ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS bconnect_revision_v1 bigint NOT NULL DEFAULT 1;

-- All writers, including Base44 and generic app-data, advance the same revision.
CREATE OR REPLACE FUNCTION public.bconnect_invoice_revision_trigger_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.bconnect_revision_v1 := OLD.bconnect_revision_v1 + 1;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bconnect_invoice_revision_v1 ON public.purchase_invoices;
CREATE TRIGGER bconnect_invoice_revision_v1
BEFORE UPDATE ON public.purchase_invoices
FOR EACH ROW EXECUTE FUNCTION public.bconnect_invoice_revision_trigger_v1();

CREATE TABLE IF NOT EXISTS public.bconnect_invoice_operations_v1 (
  operation_id text PRIMARY KEY,
  request_hash text NOT NULL,
  invoice_id text NOT NULL,
  result jsonb NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.bconnect_invoice_operations_v1 FROM PUBLIC, anon, authenticated;

-- Do not grant execution to clients until the atomic command implementation and
-- staff-session authorization are reviewed and its isolated tests pass.
COMMIT;

-- READ-ONLY legacy collision audit for approved branch-scoped invoice numbers.
-- Run only against a database explicitly selected by the operator.
-- This script never inserts, updates, deletes or creates indexes.
-- Review all outputs before authorizing any enforcement migration.
BEGIN READ ONLY;
-- 1. Same-branch duplicates among non-sample invoices (blocking).
SELECT branch,
       public.bconnect_canonical_invoice_number_v1(system_invoice_number) AS canonical_number,
       count(*) AS invoice_count,
       array_agg(id ORDER BY id) AS invoice_ids
FROM public.purchase_invoices
WHERE coalesce(is_sample,false)=false
  AND system_invoice_number IS NOT NULL
  AND btrim(system_invoice_number)<>''
GROUP BY branch,public.bconnect_canonical_invoice_number_v1(system_invoice_number)
HAVING count(*)>1
ORDER BY invoice_count DESC,branch,canonical_number;
-- 1b. Classify legacy same-branch collisions without mutating records.
-- Matching signatures are only candidates for manual duplicate review.
-- Different signatures must never be automatically merged or renumbered.
WITH normalized AS (
  SELECT id, branch, invoice_date, supplier_id, total_value, returned_value,
    public.bconnect_canonical_invoice_number_v1(system_invoice_number) AS canonical_number
  FROM public.purchase_invoices
  WHERE coalesce(is_sample,false)=false
    AND system_invoice_number IS NOT NULL AND btrim(system_invoice_number)<>''
), grouped AS (
  SELECT branch, canonical_number, count(*) AS invoice_count,
    count(DISTINCT (invoice_date,supplier_id,total_value,returned_value)) AS distinct_signatures,
    array_agg(id ORDER BY id) AS invoice_ids
  FROM normalized
  GROUP BY branch,canonical_number HAVING count(*)>1
)
SELECT branch,canonical_number,invoice_count,invoice_ids,
  CASE WHEN distinct_signatures=1 THEN 'REVIEW_POSSIBLE_DUPLICATE'
       ELSE 'REVIEW_CONFLICTING_INVOICES' END AS resolution_status
FROM grouped ORDER BY branch,canonical_number;
-- 2. Missing or unknown branch identity (blocking until classified).
SELECT branch,count(*) AS invoice_count
FROM public.purchase_invoices
WHERE coalesce(is_sample,false)=false
GROUP BY branch ORDER BY invoice_count DESC;
-- 3. Empty and zero-only or nonnumeric invoice numbers (require manual policy).
SELECT id,branch,system_invoice_number
FROM public.purchase_invoices
WHERE coalesce(is_sample,false)=false
  AND (system_invoice_number IS NULL
       OR btrim(system_invoice_number)=''
       OR public.bconnect_canonical_invoice_number_v1(system_invoice_number) !~ '^[0-9]*[1-9][0-9]*$')
ORDER BY branch,id;
-- 4. Cross-branch repeated numbers (ALLOWED by approved policy; informational).
SELECT public.bconnect_canonical_invoice_number_v1(system_invoice_number) AS canonical_number,
       count(DISTINCT branch) AS branches,
       count(*) AS invoice_count
FROM public.purchase_invoices
WHERE coalesce(is_sample,false)=false
  AND system_invoice_number IS NOT NULL AND btrim(system_invoice_number)<>''
GROUP BY public.bconnect_canonical_invoice_number_v1(system_invoice_number)
HAVING count(DISTINCT branch)>1
ORDER BY invoice_count DESC,canonical_number;
COMMIT;

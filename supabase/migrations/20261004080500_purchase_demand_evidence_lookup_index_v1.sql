-- Accelerate the canonical Demand Evidence product lookup without changing RPC behavior.
create index if not exists purchase_branch_snapshots_evidence_code_idx
on public.purchase_branch_current_snapshots
(branch, (regexp_replace(coalesce(nullif(trim(product_code),''),''), '\.0+$', '', 'g')))
include (product_key, stock_captured_at)
where inventory_eligible is true;

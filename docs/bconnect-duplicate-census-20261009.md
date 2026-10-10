# B-Connect production duplicate census — read-only

Date: 2026-10-09. Source: Supabase project `zqfsakrxazznkqnjlgzv`, `public.purchase_invoices`. Queries were SELECT-only. **Counts are a snapshot, not a cleanup instruction.**

## Findings

- Total invoices: 10,903 (Shokry: 5,941; El Shamy: 4,962).
- 179 exact raw system-invoice-number groups have multiple rows, totaling 359 records (180 beyond one record per group). Zero blank system invoice numbers.
- 13 system invoice numbers occur in both branches.
- 167 duplicate groups when grouping by exact system number plus branch.
- 144 duplicate groups when grouping by exact system number plus supplier ID.
- 24 groups share number, branch, supplier ID and invoice date.
- 110 groups share number, branch, supplier ID and total amount.
- All-invoice sync states: 10,754 active; 149 pending_delete_review.
- All-invoice duplicate statuses: 10,784 not_reviewed; 105 reviewed_not_duplicate; 7 canonical_candidate; 7 duplicate_candidate.
- Among the 359 records in exact-number duplicate groups: 242 active/not_reviewed; 101 pending_delete_review/not_reviewed; 7 active/duplicate_candidate; 7 active/canonical_candidate; 2 active/reviewed_not_duplicate.

## Interpretation and next safety gates

These overlapping counts are **not additive** and cannot prove which records are truly duplicates. The same number in different branches may reflect legitimate numbering policy; the 24 highest-similarity groups still require source ID, supplier invoice number, date, amounts, workflow status and sync provenance review. Do not delete, merge, renumber, or auto-classify any production invoice from this census.

Before enforcing any global unique index, explicitly resolve whether the invoice number is truly global and how to handle existing 179 groups and all legacy writers. Audit source-sync ingestion, app-data CRUD/bulk writers and workflow RPCs. Implement server-side atomicity and operation idempotency in a separate tested environment. UI write remains disabled pending approval.

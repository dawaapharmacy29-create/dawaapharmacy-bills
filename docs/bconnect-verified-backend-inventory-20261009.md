# B-Connect verified backend inventory (read-only)

Verified on 2026-10-09 against the existing Supabase project `zqfsakrxazznkqnjlgzv` (dawaapharmacy-bills), without modifying live data.

## Deployed invoice write paths

The deployed `app-data` Edge Function, version 6, authenticates with a custom `x-staff-session` token using `validate_staff_session`. Its deployment has `verify_jwt=false`; changing this setting without studying the custom session flow would break access.

The generic PurchaseInvoice create path sets draft status and entered-by identity, then inserts using the service-role client. The edit path first fetches the row and checks `canEditInvoice`, then separately updates by `id`. There is no atomic compare-and-swap predicate in that update. The `bulkCreate` and `bulkUpdate` actions call these same paths. The invoice workflow action uses a separate RPC. A B-Connect-only check cannot protect the other writers.

## Schema observations

The `public.purchase_invoices` table has a text primary key `id`, nullable text `system_invoice_number`, and nullable `updated_at`. It has a nonunique index on `(branch, system_invoice_number)`, but no unique index enforcing global system-invoice-number uniqueness. There is no dedicated revision column. The table contains approximately 10,900 rows.

## Unresolved release gates

1. Inventory all source synchronization and invoice write paths, including background ingestion and workflow RPCs.
2. Obtain an approved read-only duplicate census. The aggregate SQL requests attempted in this session were blocked; no duplicate count has been established.
3. Decide canonical handling for leading zeros, decimal suffixes, blank numbers, and existing duplicates before enforcing uniqueness.
4. Design a durable server revision that every writer updates, plus an atomic operation ledger and audit trail.
5. Validate all changes against disposable data with concurrent-create, stale-edit, replay, timeout-after-commit, forbidden-branch, and rollback tests.
6. Keep B-Connect write disabled until separate explicit rollout approval. No production database migration, live invoice write, main merge, or production deploy is authorized.

This document records observed facts and design prerequisites; it is not an implemented backend.

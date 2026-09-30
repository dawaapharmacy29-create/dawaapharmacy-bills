# Purchase Center Clean — Backend Contract

This document defines the non-negotiable backend contract for `/purchase-center-clean`.

## Critical clean-path RPCs

The clean purchase flow depends on these RPCs:

1. `smart_purchase_stage_dual_stock_master_v1`
   - Stages one canonical dual-branch stock stream.
   - Must not replace active stock directly.

2. `smart_purchase_finalize_dual_stock_master_v1`
   - Atomically publishes the staged stock for both branches.
   - Must verify expected row count.
   - Must reject superseded/closed stock syncs.

3. `smart_purchase_dual_branch_instant_plan_v1`
   - Builds one plan for Shokry + Shamy.
   - Must return the active `stock_sync_id` and immutable `plan_hash`.
   - Must use the canonical V10 quantities without coverage re-calculation.
   - Must include transfer-aware need and execution-pending incoming quantities.

4. `smart_purchase_create_dual_drafts_v1`
   - Creates both branch drafts transactionally.
   - Must be idempotent by `stock_sync_id + plan_hash`.
   - Must verify stored draft content against the planned quantities.
   - Must rollback the whole operation on content mismatch.

## Execution-pending / incoming truth

Incoming stock must come only from real supplier execution:

- Supplier dispatch is frozen by `smart_purchase_supplier_dispatch_guarded_v3`.
- Dispatch snapshot quantity is captured when the supplier is actually marked sent.
- Receiving is posted through `smart_purchase_import_receipt_v4`.
- Supplier receiving is cumulative, not per-file-final.
- Pending incoming is therefore:

```text
max(0, dispatched snapshot quantity - cumulative received quantity)
```

Approved-but-not-dispatched quantities must not reduce replenishment need.

## Clean flow guarantees

The clean page must preserve these guarantees:

- One uploaded stock file contains both branches.
- Stock chunks may stage concurrently, but finalize occurs only after every chunk succeeds.
- A partial upload never replaces the previous active stock.
- Re-plan does not re-upload stock.
- Draft creation is blocked on negative source balances.
- Stale legacy orders older than the configured threshold and with no dispatch/receipt execution are review-only, not hard blockers.
- Fresh executable orders still block duplicate draft creation.
- Quick Review does not alter planned quantities.
- Review Watchlist and Movement-only Watchlist never enter the automatic draft.

## Migration drift warning

The current repository history does not contain migration files that define the four critical clean-path RPCs listed above, although the frontend depends on them.

Before merging this branch to `main`, export the exact live definitions from the purchase Supabase project and commit them as additive migrations. Do not recreate them from memory or from frontend assumptions.

This is intentionally treated as a release blocker for environment reproducibility, not as a runtime blocker for the current live database.


## Mutation authorization

The clean planner is a stock-mutating and draft-creating workflow.

- Frontend route/navigation access is limited to `general_manager` and `purchasing` / `purchases`. The clean flow mutates and plans both branches atomically, so single-branch managers must not use this dual-branch entrypoint.
- Backend authorization remains mandatory; the frontend guard is not a security boundary.
- The four critical clean-path RPCs must independently reject mutation attempts from accountant, invoice reviewer, invoice entry, viewer, pharmacist, or other unrelated roles.
- Backend clean-path RPCs must reject `branch_manager` because the clean flow touches both branches in one transaction. Branch managers remain on branch-scoped workflows.

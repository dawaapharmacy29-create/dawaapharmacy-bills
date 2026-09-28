# Purchase Engine Canonical Architecture

_Last reviewed: 2026-09-28_

## Canonical runtime

- UI analysis engine: `smart_purchase_demand_transfer_preview_v10`
- Fast dashboard: `smart_purchase_dashboard_fast_v1`
- Current branch snapshots: `purchase_branch_current_snapshots`
- Current inventory intelligence profiles: `purchase_inventory_intelligence_profiles`
- Effective inventory policy view: `purchase_inventory_effective_policy_v1`
- Current frontend entry: `src/api/smartPurchaseUnifiedApi.js`

## Internal dependencies

These functions remain in the database because current production functions depend on them, but browser roles must not call them directly:

- `smart_purchase_demand_transfer_preview_v2`
- `smart_purchase_demand_transfer_preview_v3`
- `smart_purchase_demand_transfer_preview_v4`
- `smart_purchase_demand_transfer_preview_v9`

Safe Draft V4 depends on the V2/V3/V4 chain. V10 depends on V9.

## Deprecated / dormant

Do not create new callers for these:

- `smart_purchase_demand_transfer_preview_v1`
- `smart_purchase_demand_transfer_preview_v5`
- `smart_purchase_demand_transfer_preview_v6`
- `smart_purchase_demand_transfer_preview_v7`
- `smart_purchase_demand_transfer_preview_v8`
- `smart_purchase_inventory_shadow_v11`
- `smart_purchase_inventory_shadow_v12`
- `smart_purchase_consumption_bridge_auth_v1`

Browser execution has been revoked for these functions.

## Consumption intelligence

Authoritative detailed sales source lives in the admin database:

- `sales_invoices`
- `sales_invoice_items_v21`

Internal consumption profile:

- `purchase_consumption_intelligence_v1`
- canonical internal refresh: `refresh_purchase_consumption_intelligence_v2()`

The consumption profile distinguishes recurring demand from one-off bursts using invoice count, customer spread, active days, outlier share, customer concentration, trend, confidence, and demand stability.

Current seeded profile counts in the purchases database:

- Dawaa Shokry: 3,626
- Dawaa El Shamy: 3,304

No direct browser access is allowed to the consumption refresh or bridge prototype.

## Anti-accumulation rules

1. Do not add another engine version for iterative experimentation.
2. Test new replenishment logic with read-only SQL against live snapshots first.
3. Promote a new engine only after side-by-side validation against the canonical engine.
4. One final migration should represent one approved architecture change.
5. Do not expose internal dependency or shadow functions to `anon` or `authenticated`.
6. Keep manual inventory overrides separate from smart values:
   - Manual Min / Reorder / Max
   - Smart Min / Reorder / Max
   - Effective Min / Reorder / Max
7. Never auto-buy an item solely because stock is zero when demand evidence is weak.
8. One-off burst demand must not inflate automatic replenishment.
9. Transfer decisions must protect the source branch's own effective inventory policy.
10. Daily order value must remain separate from full period need.

## Next approved development direction

Do not modify the canonical V10 yet.

Next work should be validated read-only first:
- self-learning Min / Max / Reorder
- supplier lead time
- stockout frequency
- replenishment frequency
- supplier availability
- capital / dead-stock pressure
- financial state and shortage severity

Only after those rules pass shadow validation should they replace V10 in one controlled promotion.

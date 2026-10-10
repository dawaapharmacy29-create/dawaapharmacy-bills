# B-Connect invoice identity decision gate

Verified 2026-10-09 using read-only queries against existing Supabase project `zqfsakrxazznkqnjlgzv`. This is not permission to change live data.

## Evidence

- 10,903 invoices, 179 raw-number collision groups, 359 rows in those groups.
- 13 system invoice numbers occur in both branches.
- 15 groups share system number + branch + supplier ID + invoice date + total value.
- 12 groups also share supplier invoice number.
- Number `16748` appears in three rows with differences in branch, supplier, date, and total. Thus system number alone does not prove duplicate business identity.
- Number `0` appears in two records. The disabled B-Connect write contract now rejects zero-only invoice numbers; legacy records are unchanged.
- Base44 apply function upserts by source record ID, not system invoice number. Generic app-data writes are another independent path.

## Decision required before implementing a uniqueness constraint

Define and obtain explicit product-owner approval for whether `system_invoice_number` is globally unique, branch-scoped, or only a search/display identifier. Distinguish:

1. **Technical identity:** immutable source record ID + source system; edits must address an exact persisted record.
2. **Business collision warning:** same normalized system number, plus branch, supplier, date, amount and supplier invoice number. A warning is not permission to delete or reject a legitimate invoice.
3. **Confirmed duplicate:** only after provenance/source events and authoritative business records are reviewed; no automatic merging or deletion.
4. **Concurrency control:** expected server revision checked atomically for edit; stable idempotency operation ID for create; must coexist with Base44 and app-data writers.

The 12 highest-similarity groups should be triaged first by source event lineage and existing duplicate review status, without changing records. Do not deploy a global unique index on production; existing data conflicts and business numbering semantics are unresolved.

## Safe release order

Read-only lineage inspection -> identity decision -> shared server command design -> isolated disposable-fixture tests for concurrent writes and event replay -> explicit approval -> rollout. Keep the B-Connect form review-only until then.

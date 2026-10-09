# Base44 invoice event apply path — verified read-only audit

Date: 2026-10-09. Supabase project `zqfsakrxazznkqnjlgzv`. No live writes or function deployments performed.

## Confirmed chain

The deployed `base44-sync-receiver` Edge Function stores events in `base44_sync_events`, using a unique event ID to identify retries; snapshot batches are stored separately. Database function `trg_apply_base44_purchase_invoice_event` invokes `apply_base44_purchase_invoice_event(new.id)` for PurchaseInvoice events.

The `apply_base44_purchase_invoice_event` SQL function locks the source event row (`FOR UPDATE`), records an entry in `purchase_invoice_source_events`, and applies invoice create/update with `INSERT ... ON CONFLICT (id) DO UPDATE`. **Conflict is by source record ID, not by system invoice number.** A different source ID with the same invoice number can create another row. A stale-event guard compares `base44_source_updated_at`, but it does not provide cross-writer compare-and-swap for B-Connect or generic app-data updates.

Delete events mark the invoice `pending_delete_review` rather than physically deleting it. The apply function writes source-event status and invoice data in a database transaction, and includes an exception handler that marks events failed. Its existing semantics must be preserved and separately tested when designing any new write path.

## Consequences for the atomic B-Connect write

1. A B-Connect-only duplicate check cannot guarantee global uniqueness while Base44 ingestion and app-data generic/bulk writes remain active.
2. Adding a global unique constraint now would conflict with existing duplicate groups; do not run it on Production.
3. Define authoritative invoice identity (source ID vs system number, including branch policy) and coexistence with source updates before any write feature flag.
4. The concurrency policy must account for source-event upserts, app-data creates/updates, workflow changes, and B-Connect edits. Consider a shared DB boundary, with a migration plan and backfill validated in disposable fixtures.
5. Keep the existing B-Connect handoff read-only. Do not silently overwrite source-synced fields or turn `pending_delete_review` records into active invoices through B-Connect.

This audit is evidence for design, not an implementation or permission to migrate live data.

# B-Connect invoice save: server-side safety gate

Status: **design only; not deployed**. Current UI uses Base44 `PurchaseInvoice.create/update` after a client-side read. This is not atomic and must not be described as globally duplicate-proof.

## Required guarantees before enabling production writes through the handoff

1. **Single authoritative write endpoint.** The B-Connect create/edit handoff must call a trusted backend endpoint rather than directly calling Base44 create/update. It must authenticate the caller and authorize invoice create/edit for the target branch on the server.
2. **Global invoice identity.** Canonicalize the system invoice number on the server using the same rules as reconciliation. Enforce uniqueness globally, **not per branch**, with a database unique constraint or equivalent transactionally enforced invariant. A preliminary lookup is insufficient.
3. **Compare-and-swap edit.** Update only when the record ID, normalized number, branch and server-side version match the reviewed snapshot. Use an immutable revision/version (or an equivalent conditional write), not a client-only comparison. Return a conflict requiring a new review if it changed.
4. **Idempotent create.** Require a stable operation ID, scoped to the authenticated actor and intended operation. Retrying the same request must return the same committed result; a different payload for the same ID must fail. Never retry an uncertain write as a new operation.
5. **Validate on the server.** Validate supplier registry ID/name, date, financial amounts, branch, payment/category and permissions. Reject incomplete or unauthorized requests before writing.
6. **Durable audit evidence.** Invoice write and audit/outbox event must be committed atomically, or an equivalent durable mechanism must guarantee eventual audit delivery. Current `logActivity` is best-effort after write and cannot meet this guarantee.
7. **Clear outcomes.** Return created/updated with record ID and revision, conflict/duplicate, forbidden, invalid, or unknown. After an unknown outcome, the client must query the operation ID before permitting retry.
8. **Safe rollout.** First run integration tests against a disposable non-production dataset, including two concurrent creates with one number, two concurrent edits of one revision, timeouts after commit, replayed operation IDs, hidden cross-branch duplicates, and audit delivery failures. Then enable via an explicit feature flag after approval.

## Current integration boundaries

- `src/pages/BConnectInvoiceReview.jsx`: global number lookup and review.
- `src/lib/bconnectInvoiceFormHandoff.js`: proposed form state, not an authority to write.
- `src/pages/PurchaseInvoices.jsx`: existing form and **direct Base44 mutation**; the client-side fresh paginated read only narrows stale-data windows.
- `src/components/invoices/InvoiceFormDialog.jsx`: user validation and confirmation, not a substitute for backend validation.

## Release gate

**Do not merge or deploy** the handoff as an atomic or concurrency-safe workflow until the backend implementation, contract tests, permissions and production rollout are explicitly approved. Do not modify live records as part of this design work.

# B-Connect closure gate — 2026-10-09

Approved identity: normalized invoice number is unique **within the same branch**; repetition across Shokry and El Shamy is allowed.

## Read-only production audit
- Same-branch collision groups: **167** (Shokry **123**, El Shamy **44**).
- Groups sharing the same date/supplier/total/returns signature: **14** (Shokry **9**, El Shamy **5**). These are *candidates* only, not proven duplicates.
- Groups with different signatures: **153** (Shokry **114**, El Shamy **39**). Do not merge, delete, or renumber automatically.
- Query executed read-only against the existing billing Supabase project. No production changes.

## Blocking acceptance gates
1. Every same-branch collision must be reviewed against source invoice and audit evidence. Keep an explicit human decision and audit trail for any correction.
2. Confirm branch names, canonical number normalization, and all legacy writers (including Base44) before installing any uniqueness constraint.
3. Ensure new B-Connect creates and edits enforce the approved composite identity server-side, including concurrency and idempotency. Do not enable creation while this is incomplete.
4. Complete atomic full-invoice fields and end-to-end Excel → review → save → reopen tests on an isolated environment.
5. Re-run full CI, record successful SHA, and obtain explicit approval before deployment or production schema changes.

**No unique index, automatic repair, production migration, main merge, or Vercel deploy is authorized by this document.**

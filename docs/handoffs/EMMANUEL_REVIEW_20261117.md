# Review of Emmanuel's EM-C1 / EM-C2 delivery

Reviewed main: `ae587e78e3664aeb6f816c5e332688347d9d31e0` (EM-C1), `cbff31e` (EM-C2) and verification-script correction `2537fa7`. These changes are already on main; the review does not assert that they were deployed.

## Outcome

The new code is a partial implementation. A fresh-install regression was reproduced and corrected during this review. Two additional targeted checks still fail: new payments have null issuance snapshots, and a stored file stops counting against quota after the pending reservation ages out. EM-C1 and EM-C2 must not be reported complete until those cases pass.

## Corrected here

- **Fresh migration dependency:** the storage policy called `school_app.school_id()` before creating that function. The existing fresh legacy-import test failed with `function school_app.school_id() does not exist`. Moved policy creation after the function declaration. The standard backend suite then passed **77 tests / 13 files** with exit status 0 (before correction: 76 passed, one setup failure/one skipped test).
- **R2 verification request:** `verify-e04-e05.ts` now sends the signed `If-None-Match: *` header on its PUT, matching the upload URL contract. The existing frontend uploader already sends it. No live R2 operation was performed to validate the script here.

## ER-1 — P0: new receipt snapshots are never populated

`record_payment` is defined twice in the tenant migration. The new snapshot code was added to the first definition (around line 92), but the later definition (around line 222) replaces it and inserts payments without `issuance_snapshot`. A real local API payment returns `issuance_snapshot: null` and the legacy-missing provenance.

Required correction:

1. Update/consolidate the effective function while retaining all current idempotency, receipt-number, capacity, balance and audit guards.
2. Fix the dormant snapshot code's `st.name` field reference: `school_app.students` uses `full_name`.
3. Populate snapshots only when a new payment is recorded. Do not invent snapshots or overwrite historical records to backfill unknown data.
4. Prefer the recorded issuance balance for snapshot-backed receipts. The current `balance_at_issuance` enrichment still recomputes from live payment ordering/cancellation; prove backdating/later cancellation does not change the original receipt's issuance figures.
5. Add permanent API/database regressions for snapshot creation, immutability, idempotent retry, reprint after branding/name changes, cancellation, missing historical snapshots and migration reapplication.

## ER-2 — P0: quota accounting does not persist after successful material save

Upload signing inserts `storage_uploads.status='pending'`. No code finalises those reservations when resources are created/updated. Quota calculation ignores pending entries older than one hour, so stored material then disappears from usage accounting.

Reproduction: set a synthetic school's quota to 20 bytes; sign/upload/save a synthetic 20-byte PDF; age the tracking row by two hours; request another 1-byte upload. It returns **201**, although the existing saved file already consumes the whole quota (expected **409**).

Required correction:

- Finalise a verified uploaded object and its resource reference together with idempotent completion semantics. Preserve usage for replaced/unreferenced physical objects until verified deletion; expiry of a reservation is not proof a file was deleted.
- Enforce reservations atomically. The current sum-then-insert has no school-level serialization and can oversubscribe under concurrent requests. Prove concurrency behavior rather than relying on a single-request quota check.
- Add the promised grace-period, reference-safe orphan cleanup and clear quota/status responses. Map `STORAGE_QUOTA_EXCEEDED` to a stable API error and French frontend explanation.
- Review the tracking table's role policy: it currently checks school ID but not administrative membership. Add restricted-role tests for student and cross-school metadata/mutations as appropriate to the approved storage contract.
- Cover completion retry, upload failure, replacement, expired reservation, actual object deletion and concurrent reservation in permanent tests. Keep any R2 integration tests on disposable staging.

## Evidence and reproduction

Existing compilation passes. After the ordering correction, the existing 77-test backend suite passes. The two feature-specific expectations fail separately; this is why that green suite does not establish completion of these new features.

A reproduction fragment is in [emmanuel-feature-review.test.ts.txt](review-fixtures/emmanuel-feature-review.test.ts.txt). It appends to `backend/tests/tenant/content.test.ts`, reusing its synthetic-school setup and SDK storage mock. On the reviewed commit, append it to a backed-up copy of that file and run from `backend`:

```sh
./node_modules/.bin/vitest run tests/tenant/content.test.ts -t 'review:'
```

Expected reviewed behavior: two failures (null snapshot and a 201 instead of quota 409). The ten unrelated tests in that targeted diagnostic run are deliberately unselected; they are not claimed as executed. Restore the exact backed-up file afterward. Keep corrected regression tests in the normal suite when finishing the implementation. No real bucket/data is used.

## Staging link supplied by Patrick

`https://driving-schools-staging.uto--cole.workers.dev`

Attempts to GET the page, API health/config and public catalogue were blocked by this execution environment's outbound proxy with CONNECT 403 before reaching the Worker. This is **not** evidence that the app is down, and it does not establish a working deployment either. Allow that exact hostname in the execution environment's network settings or provide redacted runtime evidence for the deployed commit. No authentication credentials should be pasted in chat.

## Next handback

Return a correction commit/PR and permanent tests for ER-1 and ER-2, plus the exact staging commit, migration result and public health/catalogue/login/material checks. Coordinate receipt response fields with Willy before he finishes WI-N1. This report is the repository handoff, not a direct message or proof it has been read.

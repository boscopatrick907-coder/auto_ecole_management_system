> **Backend update, 17 November:** new payments now have populated immutable `issuance_snapshot` data, `snapshot_provenance`, issuance/current balance labels and snapshot-based issuance balance enrichment. Core creation, retry and later-name-change cases have regression coverage. Review the actual response fields with Emmanuel and use them in WI-N1; do not fabricate missing historical snapshots. Live staging and physical-device acceptance are still unverified here.

# Willy — next assignment: receipt quality and phone acceptance

17 November 2026. Patrick requested that Codex take on unfinished work and give you a new non-overlapping assignment. No newer Willy commit was present on shared `main` when checked; this does not assess unpublished local work.

## Already implemented in this delivery — preserve it

- Durable school/account-scoped active quiz drafts: answers, flags, position, original deadline and stable submission ID; recovery after reload; local clock rollback detection.
- Atomic draft-to-outbox submission, a persistent local submission list, delayed server-result display, and pending/rejected states.
- Quiz `content_version` and a version-aware grading entry point. A changed quiz yields `409 QUIZ_VERSION_CHANGED` for new versioned submissions instead of silently grading different questions. Apply the tenant migration first. Older unversioned clients retain the original endpoint compatibility; refresh old cached quiz packs before starting new attempts with this UI.
- `/s/:school/synchronisation` lists scoped pending payments/quizzes, actionable French errors and a per-entry retry retaining the same ID/body. Recovered payment entries link to the existing dossier/provisional receipt. The UI never edits or silently removes a rejected payment.
- Student-list pagination with total count, load-more, search reset and stale-response protection; learner 201+ is reachable.

Do not reimplement those features from the older WI-C1/WI-C2/WI-C4 brief. Read the current code and keep its regressions.

## WI-N1 — code the receipt renderer and verify it on phones (next priority)

### Implement

1. Coordinate with Emmanuel's EM-C2 issuance-data contract. Add explicit frontend types for the already-returned issuance/current finance fields. Use reliable issuance values where available; label current balances as current. Never invent historical school/student/legal snapshots when the backend has not supplied them.
2. Replace the receipt's fixed vertical text cursor with safe A4 pagination and a tested 80-mm ticket layout. Long school names, addresses, student names, references and cancellation reasons must remain inside the page. Preserve accents, integer FCFA and Africa/Douala dates.
3. Translate method/status enums into French. Get Patrick's decision on the hardcoded learner prefix and required signature/legal fields; do not silently change receipt numbering.
4. Distinguish confirmed, cancelled and provisional receipts visibly. Keep provisional identity stable after reload. Do not display pending offline amounts as confirmed balances.
5. Add clear print/download feedback on slow phones. Keep the existing PDF generator and school branding unless an implementation limitation is demonstrated.

### Acceptance evidence

- Meaningful PDF assertions for original/reprint, cancellation, provisional and a long-content case: inspect extracted text, amounts/labels and page bounds, not just a downloaded filename.
- Angular production build, strict TypeScript, frontend tests and existing browser regressions remain green.
- At least one Android and one iPhone check when devices are available: dossier → receipt → PDF open/share/print, slow connection and reconnect. Report device/browser and pass/fail; mark unavailable devices unrun.
- Use synthetic school/student information in fixtures and screenshots. Attach redacted samples and exact tested commit to your handback.

### Boundaries

Do not merge/deploy until Patrick authorises the release. Do not alter financial ledger rules, payment IDs or audited cancellation. If EM-C2 is not available, finish layout, translations and tests independently, then record exactly which historical-data acceptance case is blocked. The public marketing website and merchant collection remain outside this task.

## Still outstanding after this delivery

- Audited payment correction/reconciliation needs Emmanuel's API/business decision. The new review screen intentionally preserves rejected evidence rather than providing an unsafe edit/delete workaround.
- Real R2 upload/progress/quota integration, physical-device/offline/storage-full/accessibility testing and deployed end-to-end tests still need the actual staging service.
- Emmanuel owns Cloudflare/Neon access and deployment (EM-D1). A local test or a GitHub green check does not establish that a phone-accessible deployment exists.

## Ready-to-forward message

> Willy, pull the latest main after Patrick confirms this delivery. Codex has implemented quiz-draft recovery, version-bound submissions, pending-operation review and student pagination. Please start WI-N1 in docs/handoffs/WILLY_NEXT_TASK_20261117.md: receipt layout/accuracy/translation and phone acceptance. Coordinate historical receipt fields with Emmanuel, preserve the new recovery tests, and return a separate PR with PDF samples, test results and blockers. Do not rebuild the completed recovery screens or add the marketing website.

The repository is the handoff channel. Writing this assignment does not prove a direct message was sent or read.

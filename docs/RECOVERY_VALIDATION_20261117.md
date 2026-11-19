# Quiz recovery, pending-operation review and student pagination

17 November 2026. Base: `0692a57`. Patrick requested that Codex complete unfinished collaborator work and provide Willy a new assignment. Shared `main` had no newer Willy commits at inspection; unpublished work was not inspected.

## Delivered

- One active quiz draft per school/account, persisted in IndexedDB with the original question copy/version, answers, review flags, position, stable attempt ID, start/deadline and clock high-water mark. Reopening restores the draft without extending its original deadline. A changed/unpublished quiz blocks automatic recovery and offers explicit draft removal.
- Draft removal, stable submission-history creation and outbox insertion occur in one local transaction. Storage failure preserves the draft; retries preserve the same client ID, answers and taken-at timestamp. Pending and rejected attempts remain discoverable after navigation; delayed results display only the server's returned score.
- Quiz content versions increment when metadata/publication or questions change. New submissions carry `quizVersion`; the new grading wrapper rejects incompatible new attempts with `409 QUIZ_VERSION_CHANGED`, while identical accepted retries retain their result. Answer keys remain server-side.
- `/s/:school/synchronisation` lists only the current school/account's pending payments/quizzes, references, amounts, context where available, attempt counts, and useful French error messages. Per-entry retry preserves payload/identity; rejected financial evidence is neither edited nor deleted. Payment context links to the existing recoverable dossier/provisional receipt. The shell links to review instead of bulk-retrying rejected operations blindly.
- Student-list pagination consumes backend totals/cursors, reaches learner 201+, resets on a new submitted search and ignores stale requests. Account/school changes hide the old scoped view.

## Validation

From the repository root, using disposable local PostgreSQL on port 55436:

```sh
npm run build --prefix backend
XDG_CONFIG_HOME=/workspace/.config npm run build:worker --prefix backend
DATABASE_URL=postgresql://postgres@127.0.0.1:55436/legacy_test npm test --prefix backend
npm run lint --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
CI=true CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e --prefix frontend
```

- Backend compilation/Worker dry-run and Angular production/strict TypeScript checks pass.
- 77 backend tests pass across 13 files, including stale-version rejection and identical accepted retries after a quiz metadata change.
- 30 frontend tests pass across five files. New checks cover scoped draft persistence, identity changes, atomic quota-failure recovery, stable submission payloads, clock rollback/deadline handling, delayed result recovery, pagination races and scoped retries/authentication errors.
- 16 Chromium scenarios pass. New scenarios cover reload/flag/answer recovery, offline submission then delayed sync/reopen, changed-content drafts, learner 201/search reset, and rejected-payment evidence/foreign-school exclusion/provisional receipt recovery.
- Tenant tests also run against a fresh disposable `recovery_fresh` database to check clean installation and repeated migration application.

The browser scenarios use controlled API fixtures; storage is local IndexedDB. Backend integration uses real local PostgreSQL/restricted roles and Better Auth sessions. These results do not establish real Neon/R2/Cloudflare or physical-device acceptance.

## Rollout and limits

1. Apply the updated tenant migration before publishing the new frontend. It adds `quizzes.content_version`, version triggers and the version-aware grading function. Existing content/attempts are preserved; rehearse staging upgrades and take the usual backup.
2. New clients need current quiz responses that contain `content_version`; refresh old offline quiz caches. Older unversioned queued clients intentionally retain the original API behavior for compatibility. A separate policy decision is needed before retiring that path.
3. The client timer/high-water check is interruption recovery and clock-error detection, not tamper-proof proctoring. Server grading/authorization stays authoritative. This change does not introduce a server exam-start/deadline contract.
4. Existing logout policy removes active drafts and account caches. Already-queued operations remain scoped to their original identity. Local history is device-local; it does not replace authoritative server history.
5. Payment review/retry is delivered. Audited financial correction/reconciliation still needs Emmanuel's contract; the UI intentionally does not change amount/ID or delete rejected evidence as a workaround.
6. Live deployment remains blocked by Cloudflare access and remote bindings. No production data was changed, no deployment performed and no external users contacted.

Willy's replacement coding assignment and a ready-to-forward message are in [WI-N1](handoffs/WILLY_NEXT_TASK_20261117.md): receipt rendering/accuracy/translation and phone acceptance, coordinated with Emmanuel's issuance-data contract.

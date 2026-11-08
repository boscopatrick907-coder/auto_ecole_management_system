# Backend completion checkpoint — 8 November 2026

**Decision:** the approved plan supplies the business rules. This checkpoint closes the tested core backend work and adds the academic/cashier backend. It does **not** declare the whole expanded V1 production backend complete: real Neon/n8n/OTP/storage verification and the merchant-specific online collection/refund implementation remain open.

## Code delivered

Based on Emmanuel's `92bd0ba` and approved scope revision `ed4cb2e`:

- Kept the fixed 14-day trial, first-valid-payment learning access, cancellation recalculation, unpaid-trial seat rule, mandatory group/category validation, append-only finance/audit records and restricted-role RLS.
- Strengthened payment idempotency to reject changes to amount/method/reference, serialized cancellation/capacity operations, and made group occupancy specific to the paid enrollment/group.
- Fixed production OTP disclosure/delivery reporting, bounded request size, trusted CORS, normalized/bounded account throttling, pool timeouts/cleanup and production signing-key guards. Fixed-duration settings cannot extend trials.
- Added atomic invite activation, transactionally queued business notifications, an actual scheduler/worker, per-message claims/fencing, retry backoff, crash recovery, dead-letter state and admin retries. Trial reminder boundaries and weekly deduplication are explicit.
- Added admin-created instructor/cashier accounts, mandatory initial-password change, staff deactivation/session revocation, assigned rosters/content, timetable/vehicle assignment with database overlap constraints, versioned attendance corrections and audit history. Cashiers can collect but cannot cancel or change configuration; instructors cannot access finances.
- Added real resource/quiz publication APIs, authoritative grading from answers, and permit-scoped late quiz synchronization. Production never substitutes a fabricated demo lesson for a missing file.
- Added safe disabled-provider responses for MTN/Orange. No client claim or fake callback can credit money. Actual provider adapters, transaction/refund state machines and their live tests remain E14 work after merchant onboarding.
- Patched production validation/server dependencies and removed the unused validator adapter. The production build runs compiled JavaScript without tsx.
- Updated the API contract and inactive n8n relay export. One minimal frontend adapter change sends quiz answers; no frontend redesign was performed in this backend task.

## Validation evidence

- Backend production build and TypeScript checks pass.
- **40 tests pass across 8 files**, including Emmanuel's original 26 checks and 14 completion regressions.
- Verified fresh installation, schema reapplication and compiled migration execution on disposable PostgreSQL 16 databases.
- Verified the compiled production server with temporary generated credentials: health and database-backed admin login passed; bootstrap created **zero demo students and zero demo quizzes**. No real provider was contacted.
- Verified a compiled scheduler tick with external delivery disabled.
- Reproduced installation with `npm ci` after the dependency update. Production advisory scan reports no known runtime dependency vulnerabilities at the recorded check; this is not a security guarantee.
- After the dependency patch, the 1,000-concurrent-request run returned 800 HTTP 200 and 200 HTTP 201 responses with **zero failures**; p95 **2,675 ms**, p99 **2,778 ms**, elapsed **2.883 s**. Payment/receipt invariants and subsequent health remained correct.
- Machine-readable acceptance evidence is in `docs/backend-validation-20261108.json`. A GitHub Actions backend acceptance workflow was added; its remote execution is not yet verified.
- Load results are recorded separately in `docs/backend-load-20261108.json`. This is a disposable local workload, not live Neon/provider load evidence.

## Explicit release blockers and remaining work

1. **E14 / merchant onboarding:** the owner confirmed merchant accounts are not ready. Choose/approve the actual MTN/Orange merchant APIs or authorized aggregator, then implement and verify provider authentication, status/callback verification, payment intents, settlement exceptions, reconciliation and refunds. `/api/payments/intents` intentionally returns 503 until that work exists.
2. **Real Neon:** no mounted `.env` or injected database credential was available. Verify actual provider roles/grants, TLS, migrations, data compatibility and runtime limits on a disposable Neon branch. Local RLS tests do not establish live Neon readiness.
3. **Real n8n/OTP/SMS/storage:** the supplied n8n instance is `https://tich-layette.duckdns.org/`; an editor URL alone does not activate a webhook. Obtain the actual production webhook and securely configured secrets, verify the relay's runner/signature/dedup behavior and authorized recipients, and provide a real SMS fallback/storage configuration. Do not turn on worker delivery against generated test records.
4. **Frontend integration:** consume v1.3 request/response names, send actual quiz answers, implement initial staff password change, staff screens, signed offline lease verification, account/queue isolation and conflict recovery; run Android/iPhone/end-to-end acceptance. The backend key/lease utilities are not proof that the existing frontend enforces them.
5. **Production operations:** verify backups/restoration, deployment/rollback, monitoring, school-approved content/fees/legal receipts and staff workflows. Database service credentials remain server-only; pre-authentication/bootstrap/worker access must be reviewed alongside restricted business-role policies on the real host.

## Runbook

```sh
cd backend
npm ci
npm run build
# Set DATABASE_URL to a disposable local database before tests or load work.
npm test
LOAD_CONCURRENCY=1000 npm run test:load
# Development seed only, never production:
npm run db:migrate -- --seed
# Production: securely configure DATABASE_URL, CORS_ORIGINS and Ed25519/strong lease key.
# Initial production bootstrap additionally needs INITIAL_ADMIN_PHONE and a strong password.
node dist/scripts/migrate.js
npm start
# Worker: separate supervised process; external delivery defaults off.
node dist/scripts/worker.js --once
```

Use separate test and production databases. The load runner refuses remote URLs. A production migration must be backed up/reviewed; do not use a production database for generated-data tests. Changing an initial-admin environment variable is not a password-rotation procedure for an existing account.

The worker schedules once per local date and deduplicates summaries by ISO week; supervise/restart it in production. Failed delivery is retained with bounded retries; provider-side timeout ambiguity can still duplicate a message without relay/provider deduplication.

The primary checkout's older uncommitted work was preserved. The reviewed source snapshot used for this task is `/workspace/aem-backend-final-20261108`; GitHub's committed tree is the handoff source for a fresh checkout.

Production dependency updates: Zod 4.6.7 and @hono/node-server 2.1.3 (or compatible patched versions from the lockfile); the unused @hono/zod-validator dependency was removed. Production-only advisory scanning returned zero known findings at this check. Development-tool advisories and frontend dependencies are outside that scan.

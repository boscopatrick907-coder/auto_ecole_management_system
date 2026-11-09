# Emmanuel — backend, Neon and deployment handoff

**Reviewed:** main at `8ce436f`, 9 November 2026. **Priority:** make the multi-school API safe and usable in staging; do not declare the product finished from a successful database connection alone.

## What your latest commits establish

- `92bd0ba`: earlier single-school backend/business-rule corrections and tests; included in the later implementation.
- `54bacb1`: adds Neon agent skill documentation. This is tooling, not a schema deployment or Neon acceptance result.
- `8ce436f`: ignores `.env.*` while retaining `.env.example`. This helps protect untracked files; it neither removes already tracked secrets nor rotates credentials already shared.
- No newer application changes or live-Neon validation artifacts were found after the frontend/tenant implementation at `1bfdb7d`. You may have working local or deployed changes not committed here; report them with the exact commit and test environment.

## Align on the actual architecture

The launch target is **Angular 22 → Hono Cloudflare Worker → Neon**, with Better Auth, private R2 content, and multiple schools in one deployment.

| Legacy, migration reference only | New launch path |
|---|---|
| `backend/src/server.ts`, `backend/src/app.ts` | `backend/src/tenant/worker.ts`, `backend/wrangler.toml` |
| `public.app_settings`, UUID users, custom bearer sessions | `school_app.schools`, school memberships, global `identity` text IDs and Better Auth cookies |
| `/api/admin/*`, `/api/student/*` | `/api/schools/:slug/*`; Better Auth at `/api/auth/*` |
| root `.env`, `CORS_ORIGINS`, legacy signing secret | Worker bindings / `backend/.dev.vars`, `TRUSTED_ORIGINS`, Ed25519 private PEM |

The new frontend already calls the new path. Pointing it at the old server will not integrate the product. Do not replace Better Auth with Neon Auth because a newly installed skill mentions it. Global login identities are intentionally shared across schools; domain records and permissions are school-scoped.

## P0 — resolve before customer pilot

### E01. Establish and prove the staging environment

1. Report commit SHA, API entry point, frontend URL, API URL, Neon branch/database, PostgreSQL version and redacted role names. Never include passwords, tokens or full connection strings.
2. Use a disposable Neon branch. Back up and restore-test before copying real data. Never run generated-data acceptance or load tests on the real school database.
3. Create separate non-owner LOGIN roles inheriting only `aem_tenant_runtime` and `aem_identity_runtime`. Neither may own/inherit the schema owner, be SUPERUSER or BYPASSRLS. Keep owner migration credentials outside Worker bindings.
4. Validate both paths on actual Neon/Cloudflare. [context.ts](../../backend/src/tenant/context.ts) and [auth.ts](../../backend/src/tenant/auth.ts) deliberately reject unsafe roles. Test pool cleanup and transaction-local `app.user_id` / `app.school_id` under errors, retries and connection reuse.
5. Configure exact same-origin `/api/*` routing, secure cookies, trusted origins, Turnstile, signing key and R2. See the environment handoff for the exact binding matrix.

**Done:** a real restricted-role login, school catalogue, membership lookup and signed lease work from Angular; school A/student A cannot read or mutate school B/student B data.

### E02. Rehearse migration and complete the legacy-data compatibility review

Start with [MULTITENANT_MIGRATION.md](../MULTITENANT_MIGRATION.md), `backend/migrations/001_multitenant.sql` and `backend/src/tenant/import-legacy.ts`. The importer is additive, transactional and intentionally refuses problematic input; its local fixture test does not prove all live rows are compatible.

Inspect specifically:

- Missing/duplicate/case-colliding emails: legacy phone-only logins need a reviewed identity mapping or an approved phone-login implementation. Do not fabricate email addresses.
- Instructor/cashier profiles: importer rejects them because current launch memberships are admin/student. Preserve their records; do not silently turn them into admins or students. Resolve or explicitly defer that data before cutover.
- Existing global identity collisions when importing another school: current importer inserts legacy users/accounts directly. Design reviewed identity deduplication/linking before using it as a general multi-school importer. Never merge people solely from an unverified email or phone.
- Nullable legacy `groups.capacity` / `quizzes.duration_minutes` / student permit references versus the new NOT NULL fields; invalid phone formats; question option counts and answer indexes; cancellation reasons and invitation creators.
- Existing school contacts/branding, logos, schedule text, image URLs, receipt prefixes and student numbering: not all are copied by the initial importer. Preserve approved metadata and map missing fields explicitly.
- Tables intentionally not imported: old sessions/OTP verification rows, notification outbox and legacy staff/sessions/attendance/vehicles. Invalidate sessions as planned; reconcile pending financial/message operations and archive deferred history rather than dropping it unnoticed.
- Validate **counts, row-level identity/ownership, every enrollment balance, historical receipt numbers, counter maxima, audits, trial timestamps, question/attempt history and file references**. Check full key coverage, not only matching counts or an inner join that can omit missing rows.
- Bootstrap currently creates the Better Auth identity before the school transaction. A later failure can leave an account without membership. Make provisioning restartable and safe for an existing identity; no destructive duplicate-account workaround.

Use `MIGRATION_DATABASE_URL` only for explicit operator scripts. The importer requires `LEGACY_SCHOOL_SLUG` and `LEGACY_IMPORT_CONFIRM=BACKED_UP_AND_WRITE_FROZEN`; those are safeguards, not evidence that a backup was actually taken. Do not import and bootstrap the same school's users independently.

**Done:** redacted reconciliation report, migrated-admin login, migrated-student login, preserved trial/receipt history and documented rollback on a disposable branch. Get owner approval before live cutover.

### E03. Correct learning-access rule drift

[student_has_paid in the tenant migration](../../backend/migrations/001_multitenant.sql#L47) excludes payments whose enrollment is `cancelled`. The approved rule is trial running **or at least one non-cancelled payment**. Enrollment cancellation alone must not silently add a new revocation rule.

Align SQL with that rule; keep seat occupancy eligibility separate. Test an expired-trial student with a valid payment on a cancelled enrollment, then cancellation of the last valid payment. Do not introduce an installment-overdue learning block.

### E04. Complete the tenant API contract and validation

`docs/API_CONTRACT.md` mainly documents the legacy endpoints. Publish a distinct tenant contract covering actual request/response shapes, roles, cookies, errors, pagination and provisioning. Include `/api/config`, school catalogue/session/lease, enrollment/invitation, dossier, content URLs, quizzes, payments, reports, groups, settings and audited platform actions.

Fix and test:

- `admin/students` silently caps at 200 and chooses an enrollment by UUID ordering in its lateral query; the dossier chooses the latest by creation time. Add stable pagination and select the same intended enrollment deterministically. Coordinate Willy's list/load-more UI.
- A school admin can supply a custom `RC-device-sequence` receipt number. Treat it as the offline reconciliation path, prevent confusion with server/year numbering, and prove collisions/retries do not corrupt counters or amounts.
- Error/status coverage is incomplete: do not return generic 500 for predictable uniqueness, invite, finance or authorization failures. Keep 401/403/404/409/429 contracts explicit and sanitized.
- Preserve published-content metadata/explanations and validate answer indexes against options. Define how trusted staff publish/manage tenant content; the Worker currently exposes learner reads, not the older complete content-authoring surface.
- Pin the school/customer-approved receipt policy: historical identity/header snapshots versus current school details, balance-at-issuance versus clearly labelled current balance, legal fields and canceled/provisional states.

**Done:** real API contract tests and a versioned contract Willy can implement without guessing or importing legacy response names.

### E05. Verify real authentication and storage

- Run actual Turnstile verification on the intended host, rate-limit signup, and test replay/expiry failures. Do not bypass it in production to make a browser test pass.
- Choose and configure real OTP delivery if it remains a pilot requirement. Current tenant signup is email/password + Turnstile; an OTP path is **not implemented merely by configuring SMS/WhatsApp variables**. If using invitation-only onboarding initially, obtain and record that scope decision.
- Configure `AUTH_EMAIL_WEBHOOK` / `AUTH_EMAIL_TOKEN` for Better Auth recovery; verify reset expiry, single use and session revocation according to policy. Never log reset URLs.
- Publish real school-owned lessons and quiz packs, configure private R2 and CORS, and verify 120-second presigned links after school/student entitlement checks. Preserve files referenced by imported records.
- Prove forbidden students/schools cannot obtain URLs, and test last-payment cancellation and content unpublication/reassignment.

## P1 — production operations and capacity

- Configure and execute the GitHub Actions jobs; local green tests are not evidence of remote CI success. Keep production dependency audits enabled.
- Configure scheduled pg_dump to a private R2 backup bucket, a suitably privileged **backup-only** read login, lifecycle/retention and failure alerts. Match pg_dump version to actual Neon. Restore into a disposable target, reapply restricted grants and run isolation checks. Record measured RPO/RTO and checksum evidence. Neon instant restore is not the independent backup.
- Verify Cloudflare deployment/rollback, Worker execution limits, Hyperdrive pooling for both DB roles, secure headers, error monitoring and school-specific audit/support procedures. Keep migration/backup credentials separate from request credentials.
- Test a representative dataset and bounded load on disposable Neon; report requests, concurrency, errors, p95 latency, DB connections and post-load financial invariants. The recorded 1,000 requests at concurrency 20 is local evidence, not a guarantee for 1,000 simultaneous users or the free tier.

## Suggested work sequence and evidence

One focused commit per item: E01 env/role proof → E03 rule regression → E02 rehearsal/provisioning fixes → E04 tenant contract/API gaps → E05 providers/content → P1 operations. Do not let Willy build around an unstable API.

```sh
npm ci --prefix backend
npm run build --prefix backend
npm run build:worker --prefix backend
# Disposable LOCAL PostgreSQL only; configure TENANT_TEST_DATABASE_URL privately:
npm run test:tenant --prefix backend
# Original regression suite on its own disposable database:
npm test --prefix backend -- tests/phases tests/security tests/completion --no-file-parallelism
npm audit --omit=dev --prefix backend
```

The tenant test runner refuses remote hosts. Create separate read-only live smoke tests and disposable-Neon integration checks instead of weakening that safeguard.

Return a report containing SHA, entry point, redacted role/TLS evidence, migration reconciliation, API test results, provider/storage tests, restore evidence and remaining blockers. Include **no secret values**.

## Inputs to obtain from Patrick / each school
Use [the customer checklist](CUSTOMER_SCHOOL_ONBOARDING_FR.md): approved identity/logo/colors/contacts/agrément, slug, admin email/responsibilities, permits/groups/capacity, integer-FCFA tariffs/installments, real course/quiz files and rights, receipt/legal sample, migration data plus reconciliation owner, and consented pilot participants. Patrick gathers business information; you provision technical roles/keys/buckets securely. Do not ask a customer for database-owner passwords, Mobile Money PINs or unnecessary identity photographs. Record which missing input blocks each E task.

# Emmanuel — Backend and Database Correction Handoff

**Project:** Auto-école La Marseillaise
**Repository:** `boscopatrick907-coder/auto_ecole_management_system`
**Prepared:** 6 November 2026, Africa/Douala
**Assignee:** Emmanuel
**Status:** Implementation required; the backend is not yet approved for production.

**Scope update — 8 November 2026:** The owner has approved automated MTN/Orange Mobile Money collection and instructor/session operations for V1. See [the revised V1 scope](V1_SCOPE.md), which supersedes earlier scope exclusions. These additions are requirements, not completed features.

> **Distribution note:** This branch publishes the handoff document only. The findings were recorded on 6 November 2026 against local baseline `e6fd6d1` plus the earlier uncommitted corrections. Main has since advanced, including Stitch UI integration. Reproduce each finding against current code before changing it. Supporting audit scripts, additional tests and reports referenced below were local artifacts and are not included in this documentation-only branch; obtain that patch or implement the specified regressions before running commands that depend on those files. The findings and acceptance criteria in this document are self-contained.

## 1. Scope and current state

Correct the backend/database defects below, add regression tests, and verify the real Neon deployment. The owner will replace the current frontend using their Stitch design. Do not redesign the existing frontend as part of these backend corrections. Any necessary offline-client changes should be coordinated with that replacement.

The actual implementation is **Node.js + Hono + TypeScript + pg + PostgreSQL**, using custom opaque sessions and scrypt password hashing. It is not Express, Better Auth, or an already deployable Cloudflare Worker.

Use **`la-marseillaise-neon-schema.sql` as the canonical database schema**. A separate Supabase-oriented SQL file also exists; do not apply both schemas without a reviewed migration plan.

The checkout contains uncommitted corrections and additional test/report files from the earlier work. Review and preserve them; do not reset the checkout or assume Git HEAD contains every change described here. Record the final commit SHA when handing the corrected backend back to the owner.

### Verified baseline

- Backend TypeScript build passes.
- **17 existing tests pass:** 5 original security tests, 8 regression tests, 4 notification contract tests.
- Fresh schema creation and reapplication work in local PostgreSQL 16.
- Audit inspection found 18 foreign keys, no unvalidated constraints, no invalid indexes, no negative balances and no duplicate receipts in the tested dataset.
- Previously measured local load runs each completed 1,000 mixed HTTP requests without unexpected failures, including one run at 1,000 concurrent requests. These are historical local results, not live Neon results or proof that every edge case works.
- Additional probes reproduced the defects in sections 3–10 despite the passing baseline suite. The server stayed healthy afterward; an HTTP 500 response did not mean the process crashed.

### Evidence and reproduction files

| File | Purpose |
|---|---|
| `backend/scripts/audit-db.ts` | Additional correctness probes; exits 1 when requirements fail |
| `docs/backend-db-observations-20261106.json` | Raw observed failing cases |
| `docs/backend-db-audit-20261106.md` | Detailed backend/database audit |
| `docs/verification.md` | Broader specification coverage and remaining gaps |
| `backend/tests/security/api-security.test.ts` | Existing security/business-rule tests |
| `backend/tests/regression/reliability.test.ts` | Existing transaction/concurrency regressions |
| `backend/tests/notifications/n8n.test.ts` | Local notification contract tests |
| `backend/scripts/load-test.ts` | Mixed HTTP load runner; local databases only |
| `backend/scripts/check-neon.ts` | Read-only Neon connectivity/schema-presence probe |

This handoff includes the substantive findings so it can be shared independently of the other reports. File paths refer to the repository root; line numbers may change as fixes are applied.

## 2. Priorities and suggested delivery order

| ID | Priority | Correction | Evidence status |
|---|---|---|---|
| E01 | High | Restricted database roles, grants and RLS | Confirmed missing |
| E02 | High | Enforce group capacity during first-payment concurrency | Reproduced failure |
| E03 | Medium | Reject disabled licence categories for new registrations/groups | Reproduced failure |
| E04 | Medium | Require a valid group during self-registration | Reproduced failure |
| E05 | Medium | Handle concurrent quiz sync conflicts as HTTP 409 | Reproduced failure |
| E06 | Medium | Reject JSON null/non-object authentication payloads safely | Reproduced failure |
| E07 | Medium | Validate actual calendar dates and installment-plan structure | Invalid-date failure reproduced; broaden validation coverage |
| E08 | Medium | Validate UUID path/query parameters and map expected errors | Malformed dossier UUID failure reproduced |
| E09 | Release prerequisite | Verify live Neon, migrations and restricted runtime behavior | Blocked by unavailable credentials |
| E10 | Release prerequisite | Establish a stable API contract for the Stitch frontend | Integration work required |
| E11 | Release prerequisite | Signed offline lease verification and conflict reconciliation | Previously identified incomplete work |
| E12 | Required feature | Durable notifications, scheduled reminders and weekly summary | Previously identified incomplete work |
| E13 | Release prerequisite | Production credentials, deployment, backup/restore and content acceptance | External verification and completion required |
| E14 | Required V1 addition | Automated MTN MoMo/Orange Money collection, trusted confirmation, reconciliation and refunds | Newly approved; implementation/merchant verification required |
| E15 | Required V1 addition | Instructor/cashier role boundaries, assigned sessions/rosters, attendance and basic vehicle assignments | Newly approved; implementation/testing required |

Suggested implementation sequence: design E01 first; resolve E02–E08 with regression tests; finish E01 under restricted-role tests; verify E09; publish the E10 contract. Track E11–E13 explicitly rather than claiming the entire specification is complete.

## 3. E01 — Implement database-level isolation and least privilege

### Observed

`relrowsecurity=false` on `students`, `users`, `sessions`, `enrollments`, `payments` and `quiz_attempts`. The canonical schema does not provision restricted runtime roles or RLS policies. `withUserContext()` sets `app.current_user_id`, but that alone does not create database-level isolation.

Existing HTTP isolation tests pass. This finding does **not** demonstrate an unauthenticated public HTTP endpoint exposing every student's data. It establishes that the required database defense is absent.

### Inspect

- `backend/src/db.ts`: `getPool()` and `withUserContext()`.
- `backend/src/middleware/auth.ts`: session lookup happens before transaction user context is set.
- `la-marseillaise-neon-schema.sql`: tables, views, grants and `SECURITY DEFINER` functions.

### Implement

- Separate schema/migration ownership from the API runtime database role. The runtime must not be a superuser or have `BYPASSRLS`/unnecessary DDL permissions.
- Define and test access for anonymous catalogue reads, authentication/session lookup, a student's own records, and administrators.
- Enable appropriate RLS policies and restrict direct table access and function execution. Review default `PUBLIC EXECUTE` on functions.
- Review views and security-definer routines for owner-based RLS bypass. Use invoker behavior where appropriate, explicit ownership/grants and a safe search path.
- Design narrowly scoped pre-authentication lookup paths so introducing RLS does not break login/session lookup or expose unrestricted user/session records.
- Continue deriving the transaction identity from verified server authentication. Never accept an arbitrary user UUID from request data as the database identity. Database credentials must never reach frontend clients; a custom PostgreSQL setting is not independent proof of identity.
- Correct comments/documentation that claim RLS already exists.

### Acceptance tests

- Restricted runtime-role tests prove student A cannot read/update student B's profile, payments, attempts or enrollment.
- Students cannot insert payments, assign admin roles or edit access/trial fields.
- Unauthenticated requests have only intentionally public access.
- Administrators can perform required operations without using an owner/superuser connection.
- A reused pool connection does not retain the previous request's user context after commit or rollback.
- Session lookup, expiry, logout and registration still work with the actual restricted runtime role.

## 4. E02 — Enforce capacity when a first payment claims a seat

### Reproduction

1. Create an open group with capacity 1 and one 1,000 FCFA installment.
2. Create two unpaid students/enrollments in that group.
3. Submit their first 1,000 FCFA payments concurrently.
4. Both requests currently return 201; `group_occupancy` reports 2 confirmed seats for capacity 1.

### Inspect

`record_payment()` and `group_occupancy` in `la-marseillaise-neon-schema.sql`.

### Implement

- Serialize seat acquisition at group level. Locking only each student's enrollment cannot protect a shared group limit.
- Recheck occupancy and whether this enrollment/student is already entitled to its seat while holding the relevant locks.
- Define a consistent lock order for payment idempotency, group/enrollment updates and cancellations to avoid deadlocks.
- Return a stable business error such as HTTP 409 with `GROUP_FULL`; keep unrelated DB failures distinct.
- Preserve unlimited unpaid trial registration if that remains the approved rule: a trial alone must not consume a confirmed seat.
- Explicitly define cancellations, cancelled enrollments, multiple enrollments and re-payment behavior. Do not count a second payment as another seat.

### Acceptance tests

- Capacity 1 plus two competing first payments yields one accepted payment and one documented group-full rejection.
- Confirmed seats never exceed capacity across repeated/concurrent runs.
- Retrying the winning `clientId` returns the same payment without consuming another seat.
- Subsequent installments for an existing confirmed student are accepted even when the group is otherwise full.
- Cancelling a sole valid payment updates access and occupancy consistently; subsequent seat claims follow the approved rule.
- Existing overpayment, receipt uniqueness and audit immutability tests remain green.

## 5. E03 — Reject inactive licence categories for new activity

### Observed

Creating an open group for an inactive category returned 201. Registering a new student into that group also returned 201. Hiding the category in the public catalogue is insufficient: clients can submit UUIDs directly.

### Inspect

- `register_student()` in the canonical schema.
- Group creation in `backend/src/routes/admin.ts`.
- Registration in `backend/src/routes/auth.ts`.

### Implement and accept

- Check category existence and `is_active` within the relevant transaction/business operation.
- Reject new registration/group creation for inactive categories with a documented client error.
- Test direct API submissions, not only dropdown contents.
- Define and preserve existing students' learning/financial history when a category is disabled. Do not delete historical records to implement deactivation.
- Verify the transaction leaves no user, enrollment or consumed OTP behind when registration is rejected.

## 6. E04 — Require a group in self-registration

### Observed

A valid registration without `groupId` returned 201 and created a student with zero enrollments. The specification requires permit and group selection.

### Inspect

`registerSchema` in `backend/src/routes/auth.ts` and the optional enrollment insertion in SQL `register_student()`.

### Implement and accept

- Require a non-null valid group for the self-registration workflow, unless the owner explicitly changes the specification to support an unenrolled state.
- Verify group existence, open status and licence-category match in the transaction.
- Missing, null, malformed, nonexistent, closed or wrong-permit groups must produce documented 4xx responses.
- Fail atomically: no orphaned user/student, enrollment or consumed OTP.
- A valid signup creates exactly one linked user/profile/student/enrollment and starts the 14-day trial.
- Keep admin walk-in creation and invitation activation semantics intact.

## 7. E05 — Make concurrent quiz conflicts return 409

### Observed

For each of 10 simultaneous pairs of quiz submissions from different students sharing a new `clientId`, one request returned 201 and the other 500. No other student's attempt was returned to the losing caller.

### Inspect

`backend/src/routes/student.ts`: `/quiz-attempts`, duplicate pre-check and `INSERT ... ON CONFLICT ... WHERE`.

### Implement

- Keep the database's unique constraint/conflict handling authoritative; pre-checks cannot remove races.
- Convert ownership/quiz mismatches into a typed conflict mapped to HTTP 409 with `IDEMPOTENCY_CONFLICT`.
- Preserve transaction rollback for the entire submitted batch. Do not accidentally commit earlier items by returning an HTTP response from a transaction callback after a later failure.
- Preserve idempotent replays of an identical attempt by its original owner.
- Continue scoring from database questions rather than accepting client-reported scores.

### Acceptance tests

- Same owner/quiz/request repeated concurrently creates one row and returns the original attempt.
- Different owners sharing a request ID yield one 201 and one 409, never 500 and never another student's data.
- Same owner reusing an ID for another quiz is rejected.
- A conflicting item in a batch does not leave a partially committed batch.
- Offline attempts can still synchronize after trial expiry according to the approved offline policy.

## 8. E06 — Validate authentication payload shape before throttling

### Observed

With `NODE_ENV=production`, a login request containing valid JSON `null` returns 500. The rate limiter accesses `body.phone` before confirming that the body is an object.

### Inspect

`backend/src/middleware/auth-rate-limit.ts`.

### Implement and accept

- Validate/normalize parsed body shape before reading fields.
- Test null, arrays, strings, numbers, malformed JSON, empty objects and normal objects across login, OTP, registration and invite routes.
- Invalid input must return documented 400 responses, not exceptions or 500.
- Preserve request-body limits and legitimate endpoint validation.
- Keep production throttling active. Document the current per-process limitation and use a shared/gateway limiter for multiple deployment instances.

## 9. E07 — Validate dates and installment plans before SQL

### Observed

An admin group request with invalid date strings reaches PostgreSQL and returns 500. String/minimum-length checks do not establish a valid calendar date.

### Inspect

`createGroupSchema` and group creation in `backend/src/routes/admin.ts`.

### Implement and accept

- Validate actual calendar dates in the documented API format, including invalid days and leap years.
- Apply this to group start dates and installment due dates.
- Validate unique installment positions, positive integer amounts and exact sum equal to group fee.
- Document whether positions must be contiguous and due dates must follow installment order; enforce the chosen business rule consistently.
- Return 400 for invalid plans; create no partial group/installments.
- Preserve the existing `INSTALLMENT_SUM_MISMATCH` protection.
- Recheck money inputs for safe-integer limits before converting JavaScript numbers into PostgreSQL bigint values.

Only invalid-date handling was reproduced as a defect here; the additional plan/number cases are requested validation coverage, not claims that each currently fails.

## 10. E08 — Validate identifiers and centralize expected API errors

### Observed

`GET /api/admin/students/not-a-uuid` returns 500 because an invalid UUID reaches SQL.

### Inspect

`backend/src/routes/admin.ts`, other parameterized routes, and `backend/src/app.ts` error mapping.

### Implement and accept

- Validate UUID path/query parameters before database queries.
- Use a consistent error contract: 400 invalid input, 401 unauthenticated, 403 unauthorized, 404 valid ID not found, 409 business/idempotency conflict, and 500 for unexpected failures.
- Preserve existing documented error codes or coordinate any changes through E10.
- Do not expose raw SQL, stack traces or connection/credential details in client errors.
- Test malformed IDs, valid nonexistent IDs, wrong-role requests, duplicate phones and expected constraint failures.
- Confirm the API remains healthy after rejected requests and pool clients are released after exceptions.

## 11. E09 — Verify the real Neon database safely

### Current blocker

No usable `.env`, injected `DATABASE_URL` or `DIRECT_DATABASE_URL` was available in this environment. Only `.env.example` was present. The live Neon database has **not** been verified. Do not treat localhost PostgreSQL results as Neon evidence.

### Required work

- Obtain the actual securely configured database connection and confirm which branch/database is development versus production. Never put secret values in chat, source control, screenshots or this handoff.
- Run the read-only probe first. Inspect real schema/version, roles/grants/RLS, TLS/connectivity and drift against the canonical migration.
- Use a disposable Neon development branch for migrations, mutating integration tests and deployment-level load tests. The existing local load runner deliberately refuses remote URLs; do not bypass that guard to hit production.
- Configure exact endpoint network permissions where required. The ordinary API uses `pg` TCP; the separate probe uses Neon HTTP.
- Adopt reviewed/versioned migrations and document bootstrap behavior. `INITIAL_ADMIN_PASSWORD` is an initial bootstrap value; verify existing admin accounts separately rather than assuming setting it rotates an existing password.
- Check Neon connection pooling/connection limits, cold starts and real deployment timeouts.

### Acceptance evidence

Provide the tested branch identity without credentials, migration version, restricted-role test results, read-only connectivity result and explicit pass/fail outcomes. Backups and restore are covered by E13.

## 12. E10 — Freeze the backend contract for the Stitch frontend

Create an OpenAPI document or equivalent versioned API contract, based on actual route behavior after these corrections.

Document:

- Request/response/error shapes for authentication, OTP, invite activation, catalogue, student dossier/resources/quizzes, quiz sync, admin dashboard/students/groups/content/payments/cancellation/audit log.
- Identifier names: do not silently mix `categoryCode` with `licenceCategoryId`, `code` with `inviteCode`, or renamed balance/profile fields.
- Bearer-session authentication, expiry/logout behavior and trusted CORS origins.
- Integer FCFA money representation, calendar dates versus timestamps, and Africa/Douala reporting boundaries.
- Pagination/filter behavior and bounded response sizes for large student/audit/content lists.
- Idempotency and offline reconciliation contracts, including conflict responses and provisional versus server-confirmed receipts.
- Required endpoints still missing for the approved school/category/group/content management workflow; identify them explicitly rather than showing frontend controls that have no working backend.

The Stitch design guides the replacement UI. Agree the backend contract before binding new UI components to it; preserve all financial and access rules below.

## 13. E11 — Complete offline trust and conflict handling

This work spans backend and the future client. It was already identified as incomplete; it is separate from the new backend-only probes.

- The backend issues a signed lease, but the current client trusts mutable cached access-state fields rather than cryptographically verifying that lease.
- Design asymmetric signing/public-key verification suitable for an offline browser. Keep the private key server-side; never distribute an HMAC signing secret to the client.
- Define lease audience/subject, key rotation, expiry, last trusted server time, bounded offline duration and reconnection behavior. Paid access is permanent under the business rule, but a paid client must still refresh its bounded offline authorization periodically.
- Missing/invalid/expired leases and clock rollback must block protected offline content while retaining appropriate profile/payment/contact access.
- Preserve per-account cache isolation and queue ownership. Do not replay one user's operations under another user's token.
- Keep rejected mutations and show actionable reconciliation errors. Provide a safe resolution/history flow for cashier conflicts and provisional receipts; never silently delete unsynced payments.
- Test multiple devices/tabs, lost responses, duplicate retries, session expiry, payment cancellation while a device is offline, clock rollback and expired leases.

Do not promise that browser-side controls can make previously downloaded content impossible for a hostile device owner to copy or inspect.

## 14. E12 — Finish n8n notifications and schedules

### Current state

Local tests verify signing/payload/failure behavior. The n8n export was corrected, but no live workflow was imported/activated/verified. Scheduled trial/instalment reminders and the weekly direction summary remain incomplete.

### Implement

- Follow `automations/README.md` and securely configure the real n8n endpoint/signing secret and messaging-provider credentials.
- Verify webhook authentication/signature and timestamp rejection in the actual n8n runtime. Retain TLS verification. Validate exact raw-body/signature behavior and any n8n runner restrictions; do not disable verification to make it work.
- Add a durable notification outbox tied to committed business events. Queue/retry failures without rolling back a valid payment or claiming successful delivery without evidence.
- Deduplicate payment/invite notifications and scheduler jobs across retries/instances. Handle timeout ambiguity and provider outages.
- Connect trial reminders at days 7, 12 and 14; upcoming/overdue installment reminders; and a weekly direction summary, scheduled for Africa/Douala.
- Define SMS fallback or explicitly flag it as unavailable pending provider selection.
- Test only authorized recipients. Automated tests using generated phone numbers must never trigger real messages.

### Acceptance tests

Invalid/expired signatures are rejected; valid authorized test events are delivered once; outages create retryable outbox records; worker restarts do not lose events; repeated scheduled runs do not duplicate reminders; paid/expired/cancelled states select the correct recipients.

## 15. E13 — Complete release and operational verification

- Choose and document the actual Node hosting/deployment architecture. Do not label this code a Cloudflare Worker without implementing/testing the required runtime/database adaptation.
- Verify production secret requirements, admin account safety and trusted origins. Remove development credentials/data from the production release path.
- Confirm HTTPS and authenticated resource URLs. Keep teaching files isolated by permit/access policy and validate the actual school content; generated demo PDFs and placeholder video/image paths are not production course material.
- Add school-approved resources/questions, receipt branding/legal details and contact data. Verify downloadable/printable PDF receipts and Excel/PDF roster contents with real acceptance samples.
- Reconcile dashboard totals and six computed statuses across multiple groups/enrollments, partial/overdue/cancelled payments, completion and timezone boundaries.
- Verify backups, retention and a restore drill in a non-production database. Confirm hosting/provider accounts are owned by the school.
- Check log redaction, operational health, pool exhaustion/timeouts, monitoring and sustained traffic on the actual deployment.
- Coordinate Android/iPhone offline/install acceptance with the Stitch frontend implementation. Chromium-only tests are not evidence of Safari/device compatibility.
- Track larger-data pagination, content delta sync, download storage/quota management and progress/mastery features still missing from the approved scope.

## Expanded V1 work: E14 and E15 (approved 8 November 2026)

**E14 — Automated Mobile Money:** implement server-side intents, authenticated provider callbacks/status checks, idempotent ledger posting, pending/failed states, received-funds exception reconciliation and audited refund handling for MTN MoMo and Orange Money. Do not treat a screenshot, client redirect or USSD code as settlement proof. Pending transfers never unlock access. Integrate capacity/balance concurrency, unique receipts and the durable notification outbox. Sandbox and authorized live provider evidence are required.

**E15 — Staff and sessions:** add distinct instructor/cashier role boundaries, direction-managed group/session assignments, limited instructor rosters, attendance and audited corrections, basic vehicle records/assignments and published timetables. Instructors cannot access financial operations or unrelated groups. Student self-booking remains outside V1. Coordinate the extra screens with the owner's Stitch frontend.

`docs/V1_SCOPE.md` defines the detailed requirements, permission defaults, prerequisites and acceptance tests for these additions. Update the API contract, migrations, tests, milestones and effort estimates accordingly. Existing audit findings remain open until verified fixes exist.

## 16. Business rules that must remain intact

1. Learning access is an active 14-day trial **or** at least one valid non-cancelled payment.
2. An overdue installment does not remove access unlocked by a valid first payment.
3. Cancelling the only valid payment recalculates access; an expired unpaid student is locked out of learning content.
4. A walk-in student's trial starts at account activation, not desk creation.
5. Students cannot create/edit payments or view another student's records.
6. Financial amounts, balances, installment states and student statuses are computed; no manual balance overrides.
7. Payments stay append-only: corrections use cancellation with a reason and a replacement entry. Preserve the audit trail.
8. Each receipt is unique; offline retries cannot charge twice or consume another seat.
9. Unpaid trial enrollment does not reserve a confirmed group seat.
10. Quiz sync and offline cashier actions survive connectivity loss and are reconciled under the correct account.
11. An expired student retains appropriate profile, payment-history and school-contact access.
12. Revised V1 includes online MTN/Orange collection and instructor operations under `docs/V1_SCOPE.md`. Only trusted provider confirmation can credit an online payment. Assigned-session attendance and least-privilege staff access are required. Student self-booking and advanced lesson reservations remain deferred.

## 17. Reproduce and validate

Use the existing checkout. Cloud tasks are already isolated; no additional Git worktree is required unless the owner asks for one. Preserve the current uncommitted work.

Use a **disposable local** PostgreSQL database. The commands below assume the audit database already exists and use its local development authentication; they are not production credential guidance.

```sh
cd /workspace/auto_ecole_management_system/backend
npm ci
npm run build

# Seeds/migrates the disposable database and runs the existing suite.
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/aem_audit_20261106 npm test

# Reproduces the additional failing requirements; exit 1 currently means defects remain.
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/aem_audit_20261106 \
  AUDIT_REPORT_PATH=../docs/emmanuel-audit-results.json \
  node_modules/.bin/tsx scripts/audit-db.ts

# Mixed real HTTP traffic; creates generated local test records.
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/aem_audit_20261106 \
  LOAD_CONCURRENCY=50 npm run test:load
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/aem_audit_20261106 \
  LOAD_CONCURRENCY=1000 npm run test:load

# Only after securely configuring the real Neon connection: read-only probe.
NODE_USE_ENV_PROXY=1 npm run test:neon
```

After fixing a defect, add an assertion of the required behavior to the normal regression suite. Update the separate audit runner carefully to test the corrected behavior and prerequisites; it currently creates an inactive-category group successfully as part of reproducing E03, so that setup must change once group creation correctly rejects inactive categories. Do not weaken assertions to turn the report green.

Keep test outcomes separate: pass, fail, blocked and unrun. Record load workload, concurrency, data size, environment, error counts, latency percentiles and post-run balance/receipt/health checks. A 1,000-request result is a measured scenario, not a universal guarantee that the app cannot fail.

## 18. Emmanuel's delivery checklist

- [ ] Preserve/review the existing uncommitted work and record the implementation commit SHA.
- [ ] E01–E08 corrected with permanent regression tests.
- [ ] All existing business-rule/security tests remain green.
- [ ] Restricted database-role/RLS tests pass, not only owner-role tests.
- [ ] Fresh installation and upgrade/reapplication tests pass on disposable databases.
- [ ] Normal and conflicting concurrent workloads return documented responses without unexpected 500s.
- [ ] Live Neon verified with explicit branch/environment evidence; no production data was used for mutating tests.
- [ ] API contract delivered for the Stitch frontend.
- [ ] E11–E15 completed or individually marked blocked/incomplete with an owner and precise prerequisite.
- [ ] Both Mobile Money operators have settlement/replay/refund/concurrency acceptance evidence.
- [ ] Instructor/cashier assignment and financial-access isolation tests pass.
- [ ] Revised effort, milestones and provider dependencies reflect the expanded V1.
- [ ] No secrets committed or printed; no real notifications sent by generated-data tests.
- [ ] Updated handoff lists changed files, commands/results, migrations, rollback/deployment steps and remaining limitations.
- [ ] Production readiness is claimed only after the release prerequisites and school acceptance checks pass.

**Expected handback:** corrected backend/database changes, Mobile Money and staff/session implementations, migration files, regression tests, API contract, test/load evidence, Neon/n8n/payment-provider verification status and a short list of unresolved external prerequisites. No frontend redesign is included in this assignment.


---

## 19. TDD Phase Execution & Verification Evidence

All corrections (`E01`–`E12`) were executed under strict **Red -> Green Test-Driven Development (TDD)** across 6 sequential phases plus the existing security suite (`26/26` assertions passing across 7 test files):

| Phase | Test Suite File | Covered Items | Initial Red Run | Final Green Run |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | `backend/tests/phases/phase1-validation-errors.test.ts` | `E06`, `E07`, `E08` (Malformed JSON/non-object auth guard, sliding-window rate limiter `429`, strict ISO calendar dates & leap-year checks, safe-integer FCFA bounds, contiguous chronological installment positions `1..N`, UUID param guard `400 INVALID_UUID`) | `4 failed \| 1 passed` | **5 / 5 passed** |
| **Phase 2** | `backend/tests/phases/phase2-catalogue-registration.test.ts` | `E03`, `E04` (Reject inactive permit categories in group creation, walk-in student creation & self-registration; require mandatory `groupId` in `POST /api/auth/register`; atomic transaction rolling back user + OTP consumption on failure) | `3 failed` | **3 / 3 passed** |
| **Phase 3** | `backend/tests/phases/phase3-concurrency-idempotency.test.ts` | `E02`, `E05` (Row-level `FOR UPDATE` lock on `public.groups` inside `public.record_payment` preventing concurrent first-payment seat overbooking `409 GROUP_FULL`; cross-enrollment/cross-student `clientId` collision detection `409 IDEMPOTENCY_CONFLICT` with batch rollback) | `2 failed` | **2 / 2 passed** |
| **Phase 4** | `backend/tests/phases/phase4-rls-least-privilege.test.ts` | `E01` (`aem_app_runtime` role with `NOBYPASSRLS` & `NOSUPERUSER`; `SET LOCAL ROLE aem_app_runtime` inside `withUserContext`; RLS enabled & enforced across all 18 tables; `security_invoker = true` on `enrollment_balances` & `installment_status`; `trg_students_protect_fields` trigger) | `3 failed \| 1 passed` | **4 / 4 passed** |
| **Phase 5** | `backend/tests/phases/phase5-lease-and-outbox.test.ts` | `E11`, `E12` (Asymmetric `EdDSA`/`Ed25519` offline lease signing, `GET /api/auth/lease-public-key`, `evaluateOfflineLease` checking account binding/clock rollback/expiry; HMAC-SHA256 webhook signature & timestamp replay guard; durable `public.notification_outbox` & deduplicated `Africa/Douala` reminders) | `4 failed` | **4 / 4 passed** |
| **Phase 6 (Master Combined)** | `backend/tests/phases/phase6-final-combined.test.ts` | `E09`, `E10`, and end-to-end combined verification of Phases 1–6 + all 12 business rules (`runNeonVerificationProbe`, `docs/API_CONTRACT.md`, category/group/settings management, RLS, EdDSA lease, idempotency, capacity lock, outbox) | `3 failed` | **3 / 3 passed** |
| **Security Suite** | `backend/tests/security/api-security.test.ts` | Core BOLA/BFLA, 14-day trial paywall, permanent unlock on 1st payment, append-only ledger triggers, cancellation recalculation, and one-time SHA-256 walk-in invite claim | Verified | **5 / 5 passed** |

### Live Neon Read-Only Probe Evidence (`npm run test:neon`)
- **Redacted Endpoint:** `ep-ti***er.c-9.us-east-2.aws.neon.tech` (`neondb`, PostgreSQL 17.11)
- **TLS Active:** `true`
- **Restricted Runtime Role (`aem_app_runtime`):** `rolsuper: false`, `rolbypassrls: false`, `rolcreatedb: false`, `rolcreaterole: false`
- **RLS Enabled Tables:** `18 / 18` (`missingRlsTables: []`)
- **Security Invoker Views (`enrollment_balances`, `installment_status`):** `true`

### Remaining External Enterprise Prerequisites (`E13`)
As detailed in `production_readiness_plan.md`, final production cutover awaits the enterprise-owned inputs:
1. Official school legal/fiscal headers (`NIU`, `RCCM`) and approved CEMAC course PDFs & exam question bank.
2. Production Meta WhatsApp Cloud API token / live n8n instance activation and optional SMS gateway provider selection (currently flagged as `smsFallbackStatus: "unavailable_pending_provider"`).

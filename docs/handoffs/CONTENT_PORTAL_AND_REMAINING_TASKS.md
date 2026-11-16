# Content portal delivery and remaining collaborator tasks

Updated 16 November 2026. Base checkout: `3d02357`. This update supersedes the earlier statement that content authoring is outside the current assignment: Patrick explicitly requested the admin learning-material and quiz portal. The marketing website is excluded from this change. Automatic merchant collection, automated WhatsApp, instructor/fleet features and subscription billing remain deferred.

## Delivered in this change

- Admin navigation: **Contenus**, `/s/<school>/admin/contenus`.
- Permit-category creation directly from the portal, followed by course/material creation and editing by category; private PDF, PNG/JPEG/WebP and MP4 uploads, or explicitly external HTTPS links.
- Admin-only draft previews; draft/published lists; publish/unpublish controls; French loading, empty, success and error states.
- Quiz editing: 2–6 choices, correct answer, explanation, optional HTTPS image, 1–240 minutes, up to 100 questions, preview and duplication.
- Atomic question replacement, scoped IDs, audit entries and protection of submitted attempts. Once a quiz has attempts, duplicate it to change questions; metadata and publication can still be edited.
- Presigned private uploads expire after 300 seconds and bind type, length and create-only object writes. Client and server limit each file to 25 MiB. Before a private material record is created or published, the server checks actual R2 metadata and file magic bytes. This is format validation, not malware scanning.
- New quiz submissions explicitly check current learning entitlement in the security-definer grading function; matching prior attempts retain their idempotent replay behavior.
- Existing private student GET links remain short-lived (120 seconds) and behind entitlement/RLS checks. Draft preview does not grant students access to drafts. Already downloaded files cannot be remotely revoked.

## Validation and precise limits

The delivery report in this chat records actual command results. Automated tenant/API tests use disposable local PostgreSQL and real Better Auth cookies; storage reads in those tests are mocked at the SDK boundary. Browser authoring tests use controlled API/upload fixtures. Neither establishes a real R2 upload or deployed Cloudflare/Neon acceptance.

No production data, provider account or external recipient is used. A real private R2 bucket, scoped server-side credentials, exact-origin bucket CORS and a deployed staging stack remain necessary for live acceptance. The new SQL functions must be applied through the tenant migration before using question editing. Never run generated test suites against a school database.

## Emmanuel — backend, database and operations

- [ ] **P0: Apply/rehearse the updated tenant migration on a disposable staging branch.** Verify existing data survives, the restricted runtime can execute `admin_replace_questions`, and a transaction failure leaves the entire quiz unchanged. Fresh local migration coverage is not proof of live upgrade compatibility.
- [ ] **P0: Verify real private R2 authoring.** Configure exact allowed origins and PUT/GET/HEAD CORS; allow `Content-Type` and `If-None-Match` request headers. Prove upload, object metadata/magic checks, draft preview, publication, denied student upload and cross-school access using actual storage. Keep the bucket private and never put R2 secrets in frontend settings.
- [ ] **P0: Provide deployed-stack evidence.** Record commit/entry point, TLS, restricted application/identity roles, secure cookies, Turnstile, recovery email and negative school/student isolation. Existing scripts and connectivity commits do not replace end-to-end evidence.
- [ ] **P0: Rehearse actual legacy import.** Reconcile identities, school membership, balances, historical receipt counters, trials and file references; preserve deferred staff/history and prove rollback. Resolve identity collisions through reviewed linking, not invented emails or blanket admin rights.
- [ ] **P1: Complete backup/restore acceptance.** Verify successful scheduled private R2 backups, checksum-verified restore to a disposable cloud target, role reapplication, measured RPO/RTO and alerts. Inspect actual workflow results before claiming completion.
- [x] **Developer startup validation corrected locally.** Missing bindings now produce names and setup guidance; malformed signing keys/database URLs and partial R2 configuration are rejected without printing values. Process variables override local file defaults. Five regression tests cover these cases.
- [ ] **P1: Emmanuel — verify the startup fix with your private staging configuration** and consolidate any remaining legacy/tenant instructions. Supply only redacted results, never credential values.
- [ ] **P1: Set an object-retention policy.** Replaced files and successful uploads whose record save failed can remain unreferenced. Add a reviewed grace-period cleanup that proves a key is unused across all relevant records; never blindly delete old files. Configure per-school storage quotas and upload rate limits before broad rollout.
- [ ] **P1: Review material security policy.** Magic-byte checks do not sanitize PDFs or deeply decode video/images. Decide on malware scanning/quarantine, supported media codecs, download headers and costs according to school needs. The 25 MiB initial limit intentionally excludes large videos.
- [ ] **P1: Verify capacity and monitoring.** Measure staging latency, database connections, storage usage and cold starts under bounded load; configure error alerts and deployment rollback. Free-tier suitability must be measured.

## Willy — frontend, offline behavior and device acceptance

- [ ] **P0: Run authoring against Emmanuel's actual staging stack.** Test course create/edit → upload → draft preview → publish → entitled student download → unpublish. Verify failed uploads preserve the form, retries do not create a confirmed record prematurely, and switching accounts cannot attach a file to a different school.
- [ ] **P0: Finish payment reconciliation UX.** Preserve pending entries and provisional receipts across reload; show actionable rejection details and audited correction paths. Existing atomic enqueue fixes must be retained, not reimplemented from stale handoff text.
- [ ] **P0: Finish receipt accuracy/layout.** Use issuance versus current balances with explicit labels, establish historical school/student header policy, translate payment methods, remove/approve the hardcoded learner prefix, and test pagination/long 80-mm tickets with actual printers.
- [ ] **P1: Persist active quiz drafts.** Save school/user, stable attempt ID, answers, flags, current position and deadline. Restore after reload/backgrounding; show server results after delayed sync without fabricated scores. Active quiz component state remains volatile.
- [ ] **P1: Wire student-list pagination.** The frontend API/list must expose the backend's pages so learner 201+ is reachable and dossier/enrollment selection stays consistent.
- [ ] **P1: Exercise account/offline boundaries.** Real cookies, second tab, offline logout, expired/invalid leases, role revocation, storage eviction and quota failures; ensure cached identity never grants server authority.
- [ ] **P1: Complete mobile acceptance.** Android installation/update, iPhone instructions, screen-reader/keyboard checks, 320/390-pixel layouts, slow connections, uploads near the size limit, interrupted downloads and storage-full states. Current Chromium fixtures are not physical-device acceptance.
- [ ] **P2: Consider richer content organisation only after pilot feedback.** Ordered modules, resumable/large-video uploads, upload progress, question-image private storage and bulk quiz import are follow-up work, not delivered here. Optional question image links currently require approved HTTPS sources.

## Patrick / pilot school — required business decisions

- [ ] Supply approved identity/logo, legal receipt fields, permit categories, tariffs/installments and authorised staff responsibilities when available. Synthetic content can validate development until then.
- [ ] Supply course/question-bank files with distribution rights and a named reviewer for correct answers/explanations. Approve supported formats and storage limits.
- [ ] Decide whether phone OTP is mandatory for launch or whether email/invitation onboarding is accepted. Configuring SMS variables alone does not implement phone authentication.
- [ ] Approve receipt history/numbering policy, data retention, support arrangements, staff training and pilot acceptance criteria.
- [ ] Test the complete journey on a hosted HTTPS staging link from a phone; production launch requires explicit approval after verified acceptance. Publishing the Codex development environment is separate from deploying this application.

## Suggested order

1. Review this portal change and its local evidence.
2. Emmanuel validates migration/private storage on staging; Willy validates authoring and student access against it.
3. Close payment/receipt and interrupted-learning issues while Patrick collects approved school content.
4. Run the complete pilot journey, backup restore and device acceptance; approve launch only after recording results.

This file records work for collaborators; it does not claim they have received a message or completed these items.


## Review follow-up — 16 November 2026

Patrick requested correction of reproducibility problems rather than forwarding fixable defects to collaborators. The local missing-configuration crash was reproduced and corrected in `dev-config.ts`/`dev-server.ts`; five additional tests pass and backend compilation passes. This does not configure a real R2 bucket or establish deployed readiness.

**Emmanuel's next handback:** migration result on a disposable staging branch; real private upload/download and CORS evidence; restricted-role/TLS evidence; backup restore result; exact deployed commit. Mark each item passed, failed or blocked with its prerequisite.

**Willy's next handback:** authoring and student-use browser results against that staging origin, including access denial, interrupted upload, pending-payment recovery and real-phone behavior. Keep fixture results separate from real integration results.

These are written assignments for review, not notifications sent to either collaborator. No merge or deployment was authorised by this follow-up.

## Merge-authorised coding allocation

Patrick authorised merging the tested portal on 16 November. The latest remote session/request fixes are incorporated. Detailed coding briefs are now in each collaborator's own handoff:

- Emmanuel: **EM-C1** quota/accounting/unused-object cleanup; **EM-C2** historical receipt contract; **EM-C3** reproducible staging/backup verification.
- Willy: **WI-C1** durable quiz drafts/results; **WI-C2** payment reconciliation; **WI-C3** receipt rendering; **WI-C4** learner pagination and phone/upload usability.

Finish WI-C1 and WI-C2 first while Emmanuel establishes the receipt contract and live storage evidence. These are documented assignments, not messages sent to collaborators. Merge authorisation does not constitute production deployment or acceptance of unverified live services.

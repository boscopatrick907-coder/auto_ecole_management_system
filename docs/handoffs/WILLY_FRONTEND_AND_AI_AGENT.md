# Willy — frontend integration and quality handoff

**Reviewed:** main `8ce436f`, 9 November 2026. Keep the existing Stitch/Clarté Routière design. This is a completion/integration assignment, not a new redesign.

## What is built, and what connecting it changes

The Angular UI has lazy standalone routes, school branding, authentication/invitation screens, student dashboard/financial history, admin payments/dossiers/groups, courses/quizzes, PDF receipts, scoped Dexie data/outbox and PWA hooks. No Supabase browser SDK belongs in this product.

Real connection will populate **real school identity, learners, balances, receipts, course files and results**, and make saved actions affect the real ledger after API validation. It will not automatically fix layout, missing workflows, stale state, offline conflicts, accessibility or provider configuration.

The 7 recorded browser scenarios use controlled API fixtures. Separate backend tests exercise real PostgreSQL/Better Auth, but that is not a full browser → deployed Worker → Neon/R2 proof. Your main goal is to add that integration proof and close the following gaps.

## Ownership and boundaries

- You: `frontend/`, browser/device acceptance and tenant API consumer contract.
- Emmanuel: Worker routes, database rules/migrations, role provisioning, cloud secrets, R2 and provider configuration.
- Changes crossing the API boundary require a coordinated contract change. Never duplicate balances, installment status, payment eligibility or grading rules in Angular to work around an API defect.
- Launch: admin/student roles, manual staff-entered payments and wa.me links. Do not revive student Mobile Money checkout, instructor/attendance/planning screens or automatic WhatsApp from the older expanded scope.

## W01 — P0: real staging integration and truthful state handling

1. Get Emmanuel's staging frontend/API origin, school slug, tenant contract version and **test-account invitation**, not his database credentials. Use two schools and at least two learners.
2. Keep `/api` same-origin routing or the documented public API origin. The real services are `src/app/core/api.service.ts` and `auth.service.ts`; do not recreate the deleted legacy bearer-token adapter.
3. Add a separate real-integration Playwright suite. Keep fixture tests for deterministic UI regression. Real tests must exercise login/cookies, Turnstile-approved onboarding, invitation activation, first payment, receipt, last-payment cancellation, courses/R2, quiz grading and recovery email where configured.
4. Capture 401/403/404/409/429/offline/timeout behavior. Redirect an invalid session, show useful French messages and preserve safe queued work; do not label every exception “school not found.”
5. [`AuthService.openSchool`](../../frontend/src/app/core/auth.service.ts) falls back to cached school/identity only when `navigator.onLine` is false. Implement safe fallback for an actual network failure while that flag remains true, using a valid signed lease. Never treat an authoritative 401/403/404 as an offline success.
6. [`DataService.read`](../../frontend/src/app/core/data.service.ts) can emit cached data before a live authorization error. Clear/redirect or explicitly restrict the stale protected view on a confirmed revocation. Keep safe read-only financial/profile access according to the agreed rules.
7. Support Emmanuel's real student pagination. The current API caps at 200; a search/list must not silently hide the 201st learner. Verify dossier and list agree on the student's latest intended enrollment.

**Done:** repeatable real-stack browser report with commit, origin, test school slugs, pass/fail evidence and no tokens/passwords in logs or screenshots.

## W02 — P0: payment queue, receipts and reconciliation UI

- Preserve stable `clientId` and exactly one server ledger entry across timeout/retry/reload. A pending offline payment is **not confirmed money** and must not change confirmed balances/access on the client.
- Add an account/school-scoped pending-action view: actual student/enrollment context, amount, provisional receipt, status, retry and actionable rejection message. Existing banner/retry controls are not a full conflict-resolution workflow.
- Persist enough provisional-receipt metadata to reopen it after navigation/reload. Current `PaymentComponent.payment` is component state; the queue body alone does not provide the whole receipt UI again.
- Persist allocation and enqueue/draft as one recoverable local operation. Keep the already-fixed device/sequence survival across logout and rotation after eviction. Never reset a client ID to “fix” an ambiguous timeout: reconcile first with Emmanuel.
- Resolve blocked 400/409 actions deliberately. Explain overpayment, full group, changed identity or idempotency conflicts; retain evidence. Do not auto-delete a rejected cash entry or silently retry a changed amount under the original key. Define an audited correction/reconciliation path with Emmanuel.
- [`ReceiptService`](../../frontend/src/app/core/receipt.service.ts) prints current school metadata and current dossier balance. Agree whether a historical reprint needs issuance snapshots or explicit “current balance” labels. Do not present later balances as original balances.
- Map method/status values to French; receipt methods currently print raw enum values. The `#LM-` learner label is hardcoded: either make the school prefix configurable or obtain an explicit product decision that this is a global platform numbering convention.
- A4 and the fixed 80×210 mm ticket need content/layout checks. The renderer advances `y` without pagination; long names/addresses/references can overflow. Add dynamic height/page handling and verify accents, FCFA, legal header, amount, date in Africa/Douala, canceled/provisional markings, and signature/footer.

**Done:** confirmed and provisional receipt cases survive reload; a dropped acknowledgment creates one payment; conflict evidence remains available; extracted PDF text and long ticket layout are validated, not just its downloaded filename.

## W03 — P1: learning, drafts and offline behavior

- Persist quiz draft, answers, flags, current question, start/deadline, stable attempt ID and tenant/account scope. Current active quiz state/timer lives in component signals and is lost on reload/navigation.
- Define deadline behavior after app backgrounding or clock changes; grade only on the server. Never display a fabricated score while a queued attempt is unconfirmed.
- Show the final server result after an offline submission later syncs, and make failures/attempt history discoverable. Avoid requiring the original component to remain open.
- Verify offline packs actually contain images and only entitled school/permit content. Provide download progress, retry, removal, quota/storage-full handling and clear “not downloaded” states. Test video/large-file behavior separately.
- Check cached metadata/images after content unpublication/reassignment and entitlement expiry. If a paid user reaches the maximum offline duration, require refresh even though the business learning entitlement is permanent.
- Improve cache-first refresh consistently; the student page uses an immediate cached callback, while other screens can wait for the network before showing cached information.
- Keep ngsw restricted to shell/static assets. Do not add authenticated API response caching to ngsw or implement a fictional Background Sync guarantee.

**Done:** airplane-mode reopen, interrupted download, storage quota failure, expired lease, clock rollback and delayed quiz sync are tested on real phones and with automated regressions.

## W04 — P0: identity and school isolation at the UI boundary

- Keep caches, blobs, drafts, queue entries and results keyed by school + authenticated user. Never attach a previous account's outbox to the next login.
- Test the restored `X-Expected-User` binding with real cookies and a second browser tab/account. API authorization is authoritative; a cached role never grants server permissions.
- On failed offline-lease verification, clear cached role and expected identity together with the user. `openSchool` currently clears the user but leaves the role signal populated. Verify the cached role agrees with the **signed** lease role before exposing offline financial actions.
- Review offline logout followed by an online login in another tab: the current global pending-signout marker is not bound to a specific identity. Avoid signing out the wrong newly logged-in account or reviving a logged-out one.
- Expired learners must keep the agreed profile/payment/school-contact experience while learning stays locked. Review the current expired screen's “trial” badge, course links and zero-days trial card for consistency.

**Done:** tests for school switch, account switch, role revocation, invalid lease, offline logout and simultaneous tabs; no other school/user's cached rows or pending operations appear.

## W05 — P1: finish the school-facing UX

- Preserve Inter, compiled tokens, 16 px cards, 52 px controls, clear semantic badges, bottom navigation and offline banner. Apply each school's real colors/name/logo without exposing secret configuration.
- Translate group status/method enum values through the typed French vocabulary. Provide targeted loading/empty/error/success messages rather than generic conflict messages for every failure.
- Validate school colors for usable contrast; branded buttons still need readable text. Check keyboard focus, label associations, screen readers, safe-area insets and 320/390 px layouts, including a long school name.
- Test Android installation/update and iPhone instructions. Dynamic blob manifests and SVG-only icons need actual device verification; use a tenant-specific manifest endpoint/PNG assets if required by the supported devices.
- Check recovery success/error UI, captcha expiry/re-render, invite activation and partial signup retries. No fake OTP input/delivery claim if the backend has no provider.
- Show only approved operational roles. A separate cashier role or content-authoring/platform-management UI is additional scope; do not grant everyone admin as a shortcut.
- Have the school approve a real-data dashboard and receipt sample. Any further visual improvements should be based on that review, not an automatic redesign after “connecting Neon.”

## How to use your AI coding agent

Paste this prompt, then assign **one W task at a time**:

```text
Work on the latest main of boscopatrick907-coder/auto_ecole_management_system.
Read docs/handoffs/ROADMAP_AND_RELEASE_GATES.md,
WILLY_FRONTEND_AND_AI_AGENT.md and the current tenant API contract first.
Read stitch-designs/clarte-routiere/DESIGN.md before UI edits.

Implement task W__ only. Inspect existing code and describe the defect/evidence
before editing. Preserve dirty work and Emmanuel's backend work. Scope is
multi-school Angular 22 + Hono Worker + Better Auth + Neon + R2, not Supabase.
No secrets or database connections in Angular. Keep the Stitch layout and all
French UI labels in the typed vocabulary. Keep business rules on the API/DB.
No fake balances, grades, successful payments, OTPs or message-delivery claims.

Add meaningful regression coverage for the actual defect, then implement it.
Retain stable client IDs, scoped cache/queue ownership and signed offline leases.
Do not weaken tenant RLS, auth guards or captcha to make tests pass.
If the API contract is insufficient, specify the exact endpoint/field change and
coordinate it with Emmanuel rather than introducing frontend financial logic.

Run production build, strict type check and unit tests. Run relevant browser
regressions; for integration tasks use the real staging API, not only fixtures.
Report what changed, checks passed, limitations and any backend dependency.
Make one focused commit. Before pushing, fetch main and reconcile collaborators'
changes; never force-push. Do not deploy or migrate live data during this task.
```

Commands from repository root:

```sh
npm ci --prefix frontend
npm run build --prefix frontend
npm run lint --prefix frontend
npm test --prefix frontend
# Install Chromium if needed; configure its path or PLAYWRIGHT_USE_BUNDLED=true.
npm run test:e2e --prefix frontend
```

Current `lint` is a strict TypeScript check, not an ESLint ruleset. Do not report a real-device or real-Neon test that was only simulated. Send Patrick a per-task commit/test report and the remaining blockers.

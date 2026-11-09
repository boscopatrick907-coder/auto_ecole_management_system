# Current roadmap and release gates

**As of:** 9 November 2026, Africa/Douala. **Repository reviewed:** main `8ce436f`. No arbitrary completion percentage or production date is assigned.

## Current position

**We have an implemented, locally tested multi-school foundation and UI. We are entering real-stack integration and pilot preparation, not finishing a production launch.** Emmanuel may have a working Neon setup in his environment; no newly committed evidence establishes that it uses the new tenant Worker/schema with the frontend.

Connecting frontend and backend will turn test previews into real school data and working transactions. It should make the application useful, but it does not automatically improve the visual design or close migration, offline, security, receipt, device and operational gaps. Those have explicit owners below.

## Scope precedence — read before coding

The owner's latest 9 November instructions supersede the incompatible 8 November expanded scope and Supabase/single-school assumptions:

- One deployment for many schools; school-scoped domain data/memberships, global Better Auth identity and an audited platform operator path.
- Angular → Hono Cloudflare Worker → Neon; private R2 files and verified offline access. No browser database connection or Supabase SDK.
- Launch UI: school admin/student roles; enrollment/invitation, lessons, quizzes, balances, staff-recorded payments, receipts, groups, dashboard/reports and offline queues.
- Learning trial is 14 days; access is trial running or at least one valid non-cancelled payment; cancellation recalculates access. Students cannot declare successful payments. Authoritative finance/grading remains server-side.
- WhatsApp uses manual wa.me links at launch. Automatic WhatsApp/n8n delivery, online merchant collection/refunds, instructor/attendance/planning/fleet and extra operational roles are deferred unless explicitly reapproved. Their earlier implementation/requirements remain historical assets, not completed tenant launch features.
- Multiple schools does not imply a completed SaaS subscription/billing engine, custom-domain service or self-service school onboarding. Initial commercial invoicing/onboarding can be managed manually under an agreed support contract; automation is separate scope.

`docs/V1_SCOPE.md` records the earlier expanded scope and must not be used to undo these later decisions.

## Evidence ledger

Recorded from the implementation at `1bfdb7d`; these checks were not rerun for this documentation-only review:

| Evidence | Recorded result | What it does not prove |
|---|---|---|
| Original backend regressions | 40 passed | Tenant deployment or live provider behavior |
| Tenant PostgreSQL/API/import regressions | 21 passed | All live legacy rows migrate cleanly |
| Frontend unit regressions | 9 passed | Full physical-device acceptance |
| Browser scenarios | 7 passed with controlled API fixtures | Browser → deployed Worker → live Neon/R2 integration |
| Tenant load | 1,000 mixed requests, concurrency 20, no failures/duplicates | 1,000 simultaneous customers or free-tier production capacity |
| Angular build / strict TypeScript | Passed | Every business workflow is complete |
| Worker dry-run bundle | Passed | Runtime deployment/cookies/Hyperdrive work on the chosen host |
| Production dependency scans | Zero known findings at that check | A complete security assessment or current/future advisory status |
| Backup restore | Local disposable pg_dump/pg_restore succeeded | Scheduled R2 backups and cloud restore are configured/tested |
| Live Neon cutover, R2, Turnstile/recovery delivery, Android/iPhone acceptance | Not verified in the recorded artifact | Not evidence that these services are broken elsewhere |

Sources: [validation JSON](../frontend-validation-20261109.json), [milestone log](../FRONTEND_MILESTONES.md), [setup](../FRONTEND_SETUP.md).

## Roadmap with exit gates

| Phase | Status | Owner | Required exit evidence |
|---|---|---|---|
| 1. Scope/design/tenant foundation | Code present, locally verified | Patrick/team | Later launch scope recorded; review findings triaged; historical scope clearly marked |
| 2. Backend/configuration/migration rehearsal | **Current gate** | Emmanuel | Restricted real Neon roles/TLS; Worker bindings; reviewed migration/import with reconciliation and rollback; authoritative tenant API contract; P0 business-rule fixes |
| 3. Real frontend/backend integration | **Next, with independent Willy fixes in parallel** | Emmanuel + Willy | Real browser integration against staging, two schools/two students, actual cookies/leases/content and failure cases; no fixture-only claims |
| 4. UX/offline/financial acceptance | Outstanding | Willy + school testers | Pending-payment recovery, correct PDFs, quiz recovery, role/account isolation, real Android/iPhone testing and customer-approved real-data screens |
| 5. Pilot deployment and operational readiness | Outstanding | Emmanuel + Patrick + pilot school | HTTPS/secrets/monitoring/alerts; real R2 backup and restore drill; staff training; migrated balances/receipts approved; rollback plan |
| 6. Production launch and repeatable school onboarding | Blocked by phases 2–5 | Patrick/team | Signed customer acceptance, support/data-retention arrangements, new-school checklist exercised twice, capacity/cost plan and launch approval |
| 7. Later scope | Deferred | Owner decision | Merchant accounts/provider choice, automated messaging, extra staff roles/instructor operations or commercial automation each separately approved and tested |

## Practical order now

1. Patrick sends [customer checklist](CUSTOMER_SCHOOL_ONBOARDING_FR.md) and obtains the real school identity, tariff/installment plans, course content and pilot participants.
2. Emmanuel confirms the actual testing file/entry point and performs E01/E03/E02 from his handoff on a disposable branch. No production migration based only on a pasted env.
3. Willy starts independent W02/W03/W04 regressions while the staging contract is stabilized; no mock financial logic as a workaround.
4. Emmanuel publishes the stable staging tenant API contract and limited test-account access. Willy runs W01 on that real stack and completes W05 device/design checks.
5. Team runs an agreed pilot dataset through signup/invite → school isolation → first payment → receipt → course download → offline quiz/payment → reconnection → cancellation → daily/monthly report.
6. School validates actual amounts/receipts/content; team completes backup/restore, monitoring and rollback gates, then Patrick approves launch.

## Open decisions that must not be silently guessed

- OTP delivery remains in the requested signup experience but is not implemented by the current email/password + Turnstile path. Configure a provider and complete it, or explicitly approve invitation-first/no-OTP launch scope.
- Any legacy cashier/instructor records need an approved preservation/mapping plan; do not grant admin rights merely to get the importer to run.
- Agree the historical receipt snapshot policy, learner-number prefix, legal fields and supported ticket printer format with the school.
- Obtain the actual latest private testing environment file/reference and redacted runtime results; no new file is assumed reviewed.

## Definition of production-ready

A merged commit, a good-looking preview, a database connection and local tests are all useful milestones. Production readiness requires the **combined real stack**, correct school/customer data, negative isolation tests, recoverable financial/offline behavior, verified providers/storage, operations and school acceptance. Report each gate with its evidence rather than announcing the system complete from one of these milestones alone.

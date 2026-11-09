# Auto-école La Marseillaise — Historical expanded scope (8 November 2026)

**Approved scope revision:** 8 November 2026, Africa/Douala.
**Owner decision:** Include Emmanuel's proposed automated Mobile Money payments and instructor-related features in V1.
**Status:** Requirements approved; implementation and provider readiness are not implied.

This document records the 8 November expanded scope. The owner's later 9 November multi-school launch instructions supersede its architecture and launch inclusions/exclusions. See [Current roadmap and release gates](handoffs/ROADMAP_AND_RELEASE_GATES.md) for the active scope. Keep the requirements below as historical/future-scope reference, not as proof those features are part of the current tenant launch. Historical audit findings must be rechecked against current code.

## 1. V1 objectives

Deliver a French-first, mobile-friendly school management PWA using the owner's Stitch designs, with verified backend/database behavior, real school data, reliable offline learning, administration, payments, instructor operations and production messaging.

The production-readiness roadmap remains part of V1: replace mock displays with real loading/empty/error states; connect actual backend data to Neon; configure real OTP/messaging; deploy with HTTPS and secure configuration; obtain the school's legal, financial, pedagogical and staff information.

## 2. Included modules

| Module | V1 deliverables |
|---|---|
| Accounts | Phone OTP, optional email, registration, permit/group selection, walk-in invitations, sessions and least-privilege roles |
| Learning | Permit-filtered PDF/image/video/link resources, download sizes, offline files, topic quizzes, timed mock exams, explanations and progress/history |
| Access | 14-day trial; first valid payment unlocks learning; cancellation recalculates access; bounded verified offline leases and rollback detection |
| School configuration | School identity/contact details, active permit categories, groups, fees, capacity, installment plans and staff/vehicle records |
| Cashier | Student search, payment collection, manual cash/bank/Mobile Money recording, unique receipts, balances, cancellations, audit trail, offline queue/reconciliation |
| Online Mobile Money — added | Real MTN MoMo and Orange Money collection, trusted provider confirmation, transaction tracking, reconciliation and audited refund handling |
| Direction | Four-metric dashboard, actionable follow-ups, charts, student dossiers, filters, exports, daily receipts and monthly collections reports |
| Instructors — added | Instructor accounts, assigned-group rosters, basic session timetables, vehicle assignments and attendance recording |
| Notifications | Payment confirmations, invitations, trial J7/J12/J14 reminders, installment reminders, weekly direction summary, n8n/WhatsApp and defined SMS fallback |
| Reliability | Restricted DB roles/RLS, validated APIs, idempotency, durable notification outbox, backups/restores, monitoring, browser/device and concurrency tests |

## 3. Automated Mobile Money requirements

### Collection and confirmation

- Support MTN MoMo and Orange Money through official merchant APIs or an authorized payment provider supporting those operators. Provider selection and merchant approval are deployment prerequisites.
- A student may initiate an online payment against their own enrollment. Only trusted backend/provider confirmation can create a confirmed financial ledger entry; a student cannot directly declare a payment successful.
- Store a server-generated payment intent linked to the student/enrollment, integer FCFA amount, expected merchant/operator and unique reference.
- Track at least pending, succeeded, failed, cancelled and expired outcomes. Keep provider transaction IDs and a separate, traceable refund lifecycle.
- Verify callbacks using the provider's documented signature/authentication mechanism and verify final status through its trusted API where required. Match merchant, amount, currency, reference and intended enrollment before crediting a payment.
- A browser redirect, screenshot, copied SMS, client-supplied status or USSD dial code is not proof of settlement. USSD instructions may guide a customer through an operator-approved flow; do not automate personal-wallet PIN entry or scrape messages to manufacture confirmation.

### Integrity and exceptions

- Make intent creation, callbacks, reconciliation and ledger posting idempotent. A transaction verified more than once creates one payment and one official receipt.
- Handle delayed, repeated, out-of-order, invalid and missing callbacks, timeouts and provider outages. A browser retry must not cause duplicate collection.
- Only confirmed, accepted ledger payments affect the balance and learning-access rule. Pending/failed/expired attempts do not unlock access or reserve a confirmed seat.
- Coordinate seat capacity and outstanding balance checks with payment processing. If money settles after a group fills or after another payment settles the balance, retain the verified transaction in an auditable exception/reconciliation state. Do not discard received funds, silently overfill a group or issue a duplicate ledger credit. Direction resolves the exception through an approved refund or reassignment workflow.
- A local ledger cancellation does not automatically refund money. Direction approval, provider refund confirmation, ledger treatment and notifications must remain linked and auditable. Never delete the original payment/provider events.
- Keep manual payment recording available. Mark staff-entered Mobile Money references as manual records; do not present them as automatically provider-verified transactions.

### Offline behavior and secrets

- Online collection requires connectivity. Offline users can view cached history and see a clear pending/unavailable state; the app cannot confirm a remote transfer while disconnected.
- Preserve the existing offline cashier queue for authorized staff-entered payments. Reconcile it separately from provider-confirmed online transactions.
- Merchant keys, webhook secrets and provider tokens remain on trusted servers. Never place them in frontend bundles, Git, screenshots, support chat or exported n8n workflows.

## 4. Instructor operations and basic scheduling

- Direction creates/deactivates instructor accounts and assigns instructors to specific groups/sessions.
- Direction manages basic school sessions: group, date/time, location, assigned instructor and an optional assigned vehicle. Instructors see their assigned timetable and rosters; students can view their group's published timetable.
- Store the school's required vehicle details and instructor assignments. Prevent contradictory overlapping instructor/vehicle assignments, or require an explicit, audited direction override.
- Instructors record attendance only for their assigned sessions. Track who recorded/corrected it and when; direction can review corrections with a reason.
- Instructors can see the limited academic/group information needed to teach assigned students. Do not expose receipts, merchant credentials, school-wide balances or unrelated student dossiers.
- Preserve assignment and attendance history when staff/vehicles are deactivated.
- Student self-booking of individual driving lessons, advanced rescheduling/waitlists, GPS tracking and fleet maintenance are not included in this revision.

## 5. Role boundaries

| Capability | Direction/admin | Cashier/secretariat | Instructor | Student |
|---|---|---|---|---|
| School, fees, staff and provider configuration | Manage | No | No | No |
| Student desk registration/invitations | Manage | Authorized workflow | No | Own signup/activation |
| Financial collection and receipts | Manage | Authorized workflow | No | Own online payment initiation and history |
| Cancellations/refunds | Approve and execute audited workflow | Request; cannot self-approve | No | View own status; request assistance |
| Groups, timetable and assignments | Manage | Read needed operational details | Read assigned sessions/groups | Read own published timetable |
| Attendance | Review/correct with audit | No default permission | Record assigned sessions | Read own attendance |
| Learning content/quizzes | Manage | No default permission | Read relevant assigned teaching content | Own permit/access entitlement |
| Reports and audit | School-wide as authorized | Limited cashier reports | Assigned academic records only | Own records only |

These are least-privilege V1 defaults. Validate fine-grained staff responsibilities with the school before production, and enforce them at API/database level. Adding the cashier role formally expands the earlier admin-only collection rule to specifically authorized staff; student financial writes remain prohibited.

## 6. Business invariants retained

1. The 14-day learning trial starts at self-registration or account activation for a desk-created student. It is not an installment due date.
2. Learning access is an active trial or at least one valid non-cancelled payment. Overdue installments alone do not revoke learning access after a valid first payment.
3. Cancelling/refunding the only valid payment recalculates learning access through the approved ledger workflow. Never delete historical entries.
4. Payment balances, installment statuses and student states are computed. Money uses integer FCFA and validated safe conversions.
5. Unpaid trials do not occupy confirmed group seats; confirmed payments cannot overfill a group.
6. Receipts and provider transaction references are unique; retries cannot duplicate payments, refunds, seats or notifications.
7. An expired unpaid learner retains appropriate profile, financial history and school-contact access.
8. Account/assignment isolation applies to students, instructors and cashiers, including cached data and queued operations.
9. Sessions and notifications use Africa/Douala scheduling/reporting boundaries consistently.
10. Any additional financial eligibility rule for practical sessions must be agreed with the school and implemented separately from the learning-access rule. No automatic practical-session block is inferred from the 14-day trial.

## 7. Architecture and delivery work

- Preserve the current Node/Hono backend and canonical PostgreSQL model unless an explicit architecture migration is approved. Neon is the production database target; R2 remains the planned private resource store and n8n the automation orchestrator.
- Add reviewed, versioned migrations for payment intents/provider transactions/events/refunds or equivalent financial models, instructor/cashier roles and profiles, assignments, sessions, attendance and minimal vehicle records.
- Design database constraints, indexes, restricted roles/RLS and audit policies together with these additions. Provider webhooks need a narrowly scoped service-authenticated flow, not an unrestricted admin or student identity.
- Define API contracts for collection/status/callback/reconciliation/refund workflows and assigned academic/session operations. Generate or maintain versioned API documentation for the Stitch frontend.
- Update the Stitch screen inventory and navigation to cover payment status/history, staff assignments, session attendance and operational exceptions. This scope approval does not certify that the existing 15 screens cover the expanded requirements.
- Complete the existing backend correction tasks. Scope expansion does not waive known capacity, registration, validation or concurrent-sync defects.

## 8. Acceptance and release gates

### Core and database

- Existing business/security tests remain green; all confirmed correction cases have permanent tests.
- Isolation is tested with the actual restricted runtime roles, including instructor/cashier assignment boundaries.
- Fresh migrations and upgrades work on disposable local and Neon development databases; production migration/rollback and backup/restore procedures are verified.

### Mobile Money

- Exercise both operators in an available provider sandbox, followed by authorized controlled live verification before enabling production collection.
- Verify final settlement, failure, expiry, retry after lost responses, invalid signatures, duplicates, out-of-order callbacks, incorrect amounts/currency/merchant/references, cross-student attempts and overlapping payments.
- Test received-funds exceptions for capacity/balance conflicts and the complete refund/reconciliation audit chain.
- Offline/pending states never report unverified money as a successful payment. One accepted settlement produces one balance update, one receipt and one notification event.

### Instructor/session operations

- Unassigned instructors cannot access another group's roster or change its attendance.
- Instructors cannot read/write financial records or alter fees/roles; students cannot change attendance/assignments.
- Timetables, vehicle/instructor overlap checks, attendance updates/corrections and historical deactivation behavior pass API and browser tests.

### Complete application

- Use real school-approved fees, schedules, legal identity, receipts, teaching resources/questions and staff data.
- Verify real Neon/n8n/OTP connections and durable reminders/weekly summary. Keep credentials and generated-data tests isolated from real recipients.
- Validate the Stitch implementation, offline learning/cashier reconciliation and session features on Android, iPhone and desktop.
- Repeat representative 1,000-request mixed and burst tests on a disposable deployment environment; include payment/provider and staff concurrency cases. Record workload, errors, latency and financial invariants. A load result is not a universal availability guarantee.
- Obtain school acceptance, staff training, monitored rollout and an operational owner.

## 9. Prerequisites and remaining decisions

The scope is approved; the following implementation inputs still need confirmation:

- Merchant/provider availability for both MTN and Orange, school-owned accounts, contracts/fees, sandbox/live access, callback endpoints and supported refund capabilities.
- School-approved cancellation/refund/reassignment procedures, responsibility for financial exceptions and staff permission details.
- Actual group fees/installment dates, timetable, instructor roster, vehicles and conflict-override rules.
- Official legal/branding/receipt data, course materials, quiz questions and messaging consent/templates/provider configuration.
- Production hosting/domain, securely configured credentials, backup ownership and test/production separation.

Use provider documentation and verified account capabilities. Do not invent credentials, callback authentication or delivery promises.

## 10. Explicitly deferred

Native app-store applications; student self-booking/advanced driving-lesson reservation workflows; GPS/telematics; advanced fleet maintenance; payroll/HR; additional payment operators beyond the approved MTN/Orange integration; and unapproved changes to learning-access rules remain outside this V1 revision.

**Planning impact:** automated collection/refunds and instructor/session operations expand schema, API, screens, security and acceptance work. Emmanuel must revise effort, milestones, costs and provider dependencies before committing to a release date. No new completion date or implementation claim is implied by this scope update.

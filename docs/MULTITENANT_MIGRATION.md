# Multi-school migration — implementation plan

## Existing baseline and conflicts
Main 7400fa3 contains a single-school Node/Hono/PostgreSQL API, custom UUID bearer sessions, app_settings, school-global receipt counters, and a prototype Angular 19 UI. These are not a multi-tenant Better Auth/Cloudflare implementation. The original Supabase SQL supplies business semantics, not a browser database interface.

## Target
Angular 22 calls `/api/schools/:slug/*`; Better Auth owns identity and cookies at `/api/auth/*`. Cloudflare Worker bindings hold credentials. Authentication identity tables are global (one identity can join many schools); every domain record has school_id. Authorization comes from school_members, never a request role. Platform administrators have a separate explicitly audited access path; ordinary RLS grants no implicit platform bypass.

## Migration and rollback
1. Back up the legacy database and prove restoration into a disposable branch.
2. Apply `backend/migrations/001_multitenant.sql` as the migration owner to a disposable branch. It creates isolated `identity` and `school_app` schemas and restricted roles, without dropping public data.
3. Validate the new schema, role credentials, Better Auth schema and isolation tests. Provision a school and its admin through an owner-operated bootstrap command. Never grant the runtime owner privileges.
4. Legacy data import must run as one reviewed transaction after a write freeze. Preserve IDs as text for identities. The explicit importer tags legacy scrypt hashes with a version prefix; a portable verification adapter preserves legacy logins and a regression verifies real Better Auth signin after import. New passwords use Better Auth hashing. Missing email addresses and unsupported staff roles cause an atomic refusal until reviewed mappings exist. Counts, balances, receipts and audit history must reconcile before cutover. No automatic import is executed by the Worker.
5. Deploy new API and frontend together on a staging domain, verify auth/Turnstile/R2 and acceptance. Block production cutover until migration reconciliation is signed off. Keep public legacy tables read-only for rollback.
6. Rollback before new writes: restore previous deployment. After new writes: reconcile new records before switching back; do not discard payments.

## Milestones
1. Tenant schema, restricted transactional context, Better Auth, typed Angular API/auth and guards.
2. Stitch shared controls/tokens, tenant branding, French labels.
3. Student registration/invitation, dashboard and expired access.
4. Admin dashboard, payments and receipts.
5. Student list/dossier, groups and school settings.
6. Course resources and timed quizzes.
7. School/account-scoped Dexie, durable outbox, verified offline lease, PWA updates/install.
8. Daily receipts/monthly reporting, CI audit, backup and restore runbook.

No live migration or external message is authorized by the mere presence of credentials. Existing single-school tests do not certify tenant isolation.

## Explicit import command
After backup/restore and write freeze, run `npm run tenant:import-legacy --prefix backend` with private MIGRATION_DATABASE_URL, LEGACY_SCHOOL_SLUG and LEGACY_IMPORT_CONFIRM=BACKED_UP_AND_WRITE_FROZEN. The local regression checks preserved expired trials, receipt/payment counts, balances and legacy password signin. It copies no old sessions and changes no public records. Live data can contain incompatibilities not present in the fixture; the transaction aborts rather than dropping them.

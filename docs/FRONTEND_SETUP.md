# Multi-school frontend / Worker setup

## Stack and compatibility
This implementation uses Angular 22 standalone lazy routes, signals, typed Reactive Forms, compiled Tailwind tokens, Inter and Material Symbols served locally, Dexie, jsPDF, Hono, actual Better Auth and PostgreSQL. No browser database SDK, Supabase key or database URL is used by the new frontend. The old Node single-school server remains available for migration comparison; it is not the API for the new UI. Deploy the Worker entry point in backend/wrangler.toml with this frontend.

The shell is shared by schools; routes start `/s/<school-slug>`. Names, colors, contacts and receipt headers come from school metadata. Platform school creation/status changes use the audited `/api/platform/schools` endpoint, not an implicit tenant bypass. Platform operators must be explicitly bootstrapped into school_app.platform_admins by an owner. Global identity, platform operators and their audit are the intentional exceptions to school-scoped domain records.

## Local setup
1. Node 24, npm, PostgreSQL 16+ and two restricted LOGIN credentials are needed. Run `npm ci --prefix backend` and `npm ci --prefix frontend`.
2. Back up the existing database. Apply `npm run db:migrate:tenant --prefix backend` with MIGRATION_DATABASE_URL set privately to a disposable database first. This additive migration does not import legacy public rows.
3. Create separate LOGIN roles as database owner. Grant aem_tenant_runtime to the application login and aem_identity_runtime to the identity login. Neither login may own domain tables, be SUPERUSER/BYPASSRLS or inherit the migration-owner role. Use TLS. Do not put the owner connection string in Worker bindings.
4. Copy backend/.dev.vars.example to backend/.dev.vars and configure actual values. Generate a new Ed25519 PKCS#8 key; its public counterpart is sent to browsers, never its private part. Configure a Turnstile site for the local/staging host and allow the challenge domain in the environment. The public site key is exposed through `/api/config`.
5. Provision the first school/admin using `npm run tenant:bootstrap --prefix backend` with private process values MIGRATION_DATABASE_URL, AUTH_DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, TRUSTED_ORIGINS, SCHOOL_NAME, SCHOOL_SLUG, ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters). Optional SCHOOL_ADDRESS, SCHOOL_PHONE, SCHOOL_WHATSAPP and SCHOOL_AGREMENT configure receipt headers. Existing accounts should be assigned membership by a reviewed owner operation rather than recreated.
6. `npm run dev:tenant --prefix backend -- --port 8788`; `npm start --prefix frontend`. The Angular development proxy forwards /api to localhost:8788. Visit `/s/<school-slug>/connexion`.
7. Provision permit categories and publish legitimate lessons/quizzes on the new schema through reviewed administrative provisioning until their authoring UI/API is added. Never copy demo content into production. Configure R2 bucket CORS for the frontend origin; presigned GET URLs expire after 120 seconds and are issued only after RLS/access checks.

## Production
Serve frontend/dist/auto-ecole-la-marseillaise-pwa/browser on Cloudflare Pages. Route `/api/*` on the same origin to the Worker to keep secure Better Auth cookies simple. Set BETTER_AUTH_URL to the HTTPS public origin and TRUSTED_ORIGINS to exact approved origins. Use `wrangler secret put` for secrets; configure restricted Hyperdrive APP_DB/AUTH_DB bindings when used. Deploy schema, Worker and UI as a coordinated release. The Wrangler dry run verifies bundling only, not deployed runtime compatibility.

Migration from legacy UUID users and public data uses the tested explicit importer and still needs live reviewed reconciliation (see MULTITENANT_MIGRATION.md). No existing user's authentication or payment data is automatically rewritten. Do not point the new frontend at the old /api/admin endpoints.

## Offline and receipts
ngsw caches shell/static assets only. Dexie caches school+user-scoped snapshots, signed leases and explicitly downloaded blobs. The queue retains stable client UUIDs, backs off on transient failures and keeps rejected items for review. Logout removes the current account's snapshots/files but retains its pending actions for that same account. A cross-tab Web Lock prevents simultaneous local flushes; server idempotency remains authoritative. Identity-binding headers prevent an old tab's queue from replaying under another user's cookie.

Leases expire after 72 hours even for paid users. Ed25519, subject, school, issuer, audience, expiration and clock high-water checks gate offline learning. The cached public key is established during authenticated HTTPS access; browser storage is not a DRM boundary against an owner modifying their device. Files downloaded to a user's filesystem cannot be remotely revoked.

Online receipt numbers come from the database's locked school/year counter. Offline receipts are visibly provisional RC-device-sequence values. They are confirmed only after API acceptance; a server rejection is not a payment. Existing historical receipts retain their original numbers during any approved migration.

WhatsApp actions use one wa.me service. They open a prefilled message; a person presses Send. There is no automatic delivery claim. OTP/SMS delivery requires a real provider and is not simulated. Password recovery screens call Better Auth; configure AUTH_EMAIL_WEBHOOK and AUTH_EMAIL_TOKEN to enable the server-side reset-email relay. Without those bindings the relay fails closed. Signup uses Better Auth email/password plus Turnstile; invitation claims remain hashed, expiring and single-use.

## Checks
- `npm run build --prefix frontend` — Angular production templates/bundle.
- `npm run lint --prefix frontend` — strict TypeScript check (not a separate ESLint rule suite).
- `npm test --prefix frontend` — money, installment mapping, outbox and signed lease regressions.
- `npm run test:e2e --prefix frontend` — Chromium fixtures; set CHROMIUM_PATH or PLAYWRIGHT_USE_BUNDLED=true.
- `npm run build --prefix backend` and `npm run build:worker --prefix backend`.
- `npm run test:tenant --prefix backend` — requires disposable local PostgreSQL at TENANT_TEST_DATABASE_URL; refuses remote hosts.
- Production dependency audits run in `.github/workflows/frontend-tenant.yml`.

## Remaining production prerequisites
Real Neon role/TLS checks, staged legacy import reconciliation, deployed Worker/Better Auth/Turnstile acceptance, real R2 files/CORS, school-approved receipt/content review, OTP/recovery delivery, Android/iPhone install/device testing and a cloud backup/restore drill. Instructor/planning/attendance, automatic WhatsApp and merchant collection screens are excluded from this frontend V1 as requested. Full content authoring, staff administration and platform management screens are not part of the supplied 15 designs.

## Acceptance recorded on 9 November 2026
Angular production build and strict TypeScript checks pass. Nine frontend unit regressions and seven Chromium scenarios pass (the browser scenarios use controlled API fixtures). Twenty-one tenant/API/import tests pass against disposable PostgreSQL, including real Better Auth cookies and legacy-password login. The original 40 backend tests pass after the dependency updates. A new 1,000-request mixed workload at concurrency 20 preserves payment idempotency with no failed requests; it is not a 1,000-simultaneous-user or live-Neon capacity guarantee. Both production dependency scans report zero known advisories at this check. Worker dry-run bundling passes. A local pg_dump/pg_restore drill restored the tenant and identity schemas into a separate database; cloud upload/restore is not yet verified.

Offline receipt device identity and its sequence are stored together in a school-scoped device record that survives account logout. If that storage is evicted, a fresh device identity is generated instead of reusing a reset sequence. A regression covers logout and concurrent allocation.

During additive migration both legacy and tenant copies consume storage. Check actual project quotas and branch storage before importing; the implementation does not assume a free-tier quota is sufficient for production. Hyperdrive/connection limits and real-Neon latency need a staged capacity test; the local load evidence does not cover them.

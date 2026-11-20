# Database performance handoff

Owner: backend/database engineer. These are operator instructions; no live Neon changes or hosting were performed for this update.

## 1. Evidence and scope

The owner's PC measured connections at 1,753 / 1,913 ms, and repeated `SELECT 1` requests at 290–405 ms. Successful API calls took roughly 3–10 seconds. Slow trivial queries establish a substantial connection/network component; they do not prove that every business query is efficient. More compute alone does not remove network round trips.

The code batches trusted SQL and bulk-inserts installments without changing the database schema. Runtime role verification, transaction-local role/user/school settings, RLS, validation and rollback remain enforced. No migration is needed to install this performance update.

Application transaction round trips (authentication queries and connection setup excluded):

| Request | Before | After |
| --- | ---: | ---: |
| School catalogue | 11 | 6 |
| Admin dashboard | 11 | 6 |
| Admin groups list | 11 | 6 |
| Create group with N installments | 11 + N | 8 |

Batched reads retain PostgreSQL's existing column parsers and response shapes, including bigint strings. User-supplied values continue to use query parameters. Do not interpolate input into SQL batches. Fewer round trips do not establish a measured end-to-end speedup on the owner's network.

## 2. Record the current Neon configuration

In Neon Console, select the project, then record these non-secret details:

- Cloud provider and region.
- Selected branch, database and compute endpoint; identify which branch contains the school data.
- PostgreSQL version, compute size/scaling limits and suspend settings.
- Whether each application/identity connection is direct or pooled.

Keep passwords, full connection strings and secret values in the school's secret manager or local ignored configuration, never in this document, chat, tickets, screenshots or Git. Do not move the database, recreate the school or rerun bootstrap as a performance fix.

## 3. Measure before changing configuration

From the backend directory run:

```sh
npm run db:latency
```

This reads existing environment variables, `backend/.dev.vars`, then the root `.env` as fallbacks. It opens one connection per configured application/identity URL and runs five `SELECT 1` queries on each. Output includes only setting names and durations. It does not query customer tables or change records. Environment values already exported in the shell take precedence; confirm privately that the intended test configuration is selected.

Record one run after a period of inactivity and a second immediate run. Also record whether the VPN is enabled and the network used. If permitted, compare a second network or VPN-disabled run; do not change organizational VPN policy. Do not disable TLS to benchmark.

Use the same school and dataset to measure catalogue, session, lease, dashboard and groups. Read Node `[slow API]` terminal lines and the `Server-Timing` response header. Capture browser timings too: requests made sequentially add to total screen time. Avoid repeated group-creation POSTs merely to time reads, since each successful POST creates a real group.

## 4. Check database roles and schema routing

Use separate restricted logins for application and identity requests:

- `DATABASE_URL`: login permitted to assume `aem_tenant_runtime`; no superuser, BYPASSRLS or ownership/inherited ownership of school tables.
- `AUTH_DATABASE_URL`: restricted identity login granted `aem_identity_runtime`; no superuser, BYPASSRLS or ownership/inherited ownership of identity tables. Its effective search path must resolve the Better Auth tables in `identity`.
- `MIGRATION_DATABASE_URL`: owner connection for explicit provisioning/migrations only. Keep it out of hosted request-runtime secrets.

Connect privately with each restricted login and inspect:

```sql
SELECT current_user, current_database(), current_setting('search_path');
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname = current_user;
```

Verify the appropriate runtime-role membership and effective table privileges. The API already rejects unsafe database roles; do not remove those checks to make a connection work. A pooled endpoint still needs the correct role, database and identity schema routing. If a pooler rejects startup options, use the provider-supported role/database-level configuration and reconnect; never substitute the owner URL as a workaround.

Keep TLS verification enabled. The existing SSL warning is not a connection failure. To retain today's strict behavior explicitly, the engineer can test `sslmode=verify-full` using the provider's CA configuration on a development branch first. Do not use `rejectUnauthorized: false` or `sslmode=disable`.

## 5. Place the API near the database

Choose staging backend hosting in the same cloud region as the existing Neon database when possible. Measure from that backend host; a local PC talking directly to remote PostgreSQL still pays its local network latency for every database exchange. The browser should talk HTTPS to the API, not directly to PostgreSQL.

Choose one deployment architecture deliberately:

1. **Regional Node host:** use a reviewed production entry point with persistent bounded application/identity pools, `ENVIRONMENT=production`, secure cookies, HTTPS, trusted frontend origin and graceful shutdown. The current `dev:tenant:node` entry point intentionally sets development mode; do not expose it as production unchanged.
2. **Cloudflare Worker:** the existing entry point is `src/tenant/worker.ts`. Evaluate two separate Hyperdrive configurations bound as `APP_DB` and `AUTH_DB`, each using its respective restricted login. Configure and test these explicitly; do not assume that global Node-style pools or an arbitrary Worker location eliminate database distance. Worker request pools remain request-local in this patch.

Do not pay for or provision hosting, move data or upgrade compute without the owner's authorization. First propose the exact service, region, recurring cost and rollback plan.

## 6. Investigate SQL only after measuring round-trip cost

Use a disposable Neon development branch with representative data. Compare query execution times with `SELECT 1` on the same host. If business queries remain disproportionately slow, inspect query plans for groups/confirmed seats, enrollment balances, dashboard totals and recent-payment enrichment. Run `EXPLAIN (ANALYZE, BUFFERS)` for selected reads there, with the same restricted role and transaction-local school/user context as the API. ANALYZE executes the statement: never use it on a mutating statement against live data.

Review existing indexes and representative plans before adding indexes. Check row estimates, scans, lock waits, connection counts and saturation. Do not blindly enlarge pools: the Node server currently caps each of its two pools at five connections per server process, so size aggregate connections across all replicas against Neon limits. Pooled URLs do not replace application connection limits.

## 7. Verification and handoff to the owner

Before applying schema/role/hosting changes, take and verify a backup and test restoration on a disposable target; see [BACKUP_RESTORE.md](BACKUP_RESTORE.md). This code patch itself requires no database migration.

Record a before/after table using at least ten read samples per endpoint (separately note cold-start samples): network/VPN, backend hosting region, Neon region, connection time, warm SELECT-1 min/median/max, HTTP median/p95, status/errors and dataset size. Keep the same frontend/backend revision when comparing hosts.

Confirm:

- Real admin login, catalogue, groups, dashboard and student lists work.
- Group creation returns ordered installments with the correct total and creates no partial group on failure.
- A different school's user cannot read or mutate this school's records; anonymous requests cannot access admin data.
- Failed transactions and reused connections do not retain a previous school/user/role.
- Offline payment queues, balances and receipts are preserved.
- Returning to a page shows a clearly marked verified snapshot while fresh data loads; forbidden responses clear it.

Provide the owner with the non-secret measurement table, exact changes, test results and unresolved blockers. Do not report a promised latency reduction as a measured result. Roll back the API revision and approved configuration if validation fails; preserve any new payments and other writes rather than restoring an old database over them.

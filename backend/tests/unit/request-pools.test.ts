import { expect, it, vi } from "vitest";
import { closeRequestPools, poolFor, releaseRequestPool, requestPoolFor, type TenantBindings } from "../../src/tenant/context.js";
import { requestAuth } from "../../src/tenant/auth.js";

const bindings = (node = true) => ({
  NODE_DATABASE_POOLS: node,
  DATABASE_URL: "postgresql://app:local@127.0.0.1:55436/postgres",
  AUTH_DATABASE_URL: "postgresql://identity:local@127.0.0.1:55436/postgres",
  BETTER_AUTH_URL: "http://localhost:8788",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
  TRUSTED_ORIGINS: "http://localhost:4200",
  ENVIRONMENT: "development",
}) as TenantBindings;

it("reuses Node pools across requests and keeps identities and server bindings separate", async () => {
  const a = bindings(), b = bindings();
  const app = requestPoolFor(a), identity = requestPoolFor(a, true);
  expect(requestPoolFor(a)).toBe(app);
  expect(identity).not.toBe(app);
  expect(requestPoolFor(b)).not.toBe(app);
  await releaseRequestPool(a, app);
  expect(app.ended).toBe(false);
  const query = vi.spyOn(identity, "query").mockResolvedValue({ rows: [{}] } as never);
  const auth = requestAuth(a, identity);
  expect(requestAuth(a, identity)).toBe(auth);
  await auth.$context;
  query.mockRestore();
  await Promise.all([closeRequestPools(a), closeRequestPools(b)]);
  expect(app.ended).toBe(true);
  const replacement = requestPoolFor(a);
  expect(replacement).not.toBe(app);
  await closeRequestPools(a);
});

it("keeps Worker pools request-local and closes them at request completion", async () => {
  const env = bindings(false);
  const first = requestPoolFor(env), second = requestPoolFor(env);
  expect(first).not.toBe(second);
  await Promise.all([releaseRequestPool(env, first), releaseRequestPool(env, second)]);
  expect(first.ended).toBe(true);
  expect(second.ended).toBe(true);
});

it("omits startup options for Hyperdrive and pooled URLs while keeping them for direct URLs", async () => {
  const direct = bindings(false);
  const pooled = {
    ...direct,
    DATABASE_URL: "postgresql://app:local@ep-example-pooler.us-east-2.aws.neon.tech/db",
    AUTH_DATABASE_URL: "postgresql://identity:local@ep-example-pooler.us-east-2.aws.neon.tech/db",
  } as TenantBindings;
  const hyperdrive = {
    ...direct,
    APP_DB: { connectionString: "postgresql://app:local@app.hyperdrive.local:5432/db" },
    AUTH_DB: { connectionString: "postgresql://identity:local@auth.hyperdrive.local:5432/db" },
  } as TenantBindings;

  const pools = [
    poolFor(direct, false),
    poolFor(direct, true),
    poolFor(pooled, false),
    poolFor(pooled, true),
    poolFor(hyperdrive, false),
    poolFor(hyperdrive, true),
  ];
  try {
    const opts = (p: (typeof pools)[number]) =>
      (p.options as { connectionString?: string; options?: string });
    expect(opts(pools[0]).options).toBe("-c timezone=Africa/Douala");
    expect(opts(pools[1]).options).toBe("-c search_path=identity,pg_catalog");
    expect(opts(pools[2]).options).toBeUndefined();
    expect(opts(pools[3]).options).toBeUndefined();
    expect(opts(pools[4]).connectionString).toBe(hyperdrive.APP_DB!.connectionString);
    expect(opts(pools[4]).options).toBeUndefined();
    expect(opts(pools[5]).connectionString).toBe(hyperdrive.AUTH_DB!.connectionString);
    expect(opts(pools[5]).options).toBeUndefined();
  } finally {
    await Promise.all(pools.map((p) => p.end()));
  }
});

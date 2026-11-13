import { expect, it, vi } from "vitest";
import { closeRequestPools, releaseRequestPool, requestPoolFor, type TenantBindings } from "../../src/tenant/context.js";
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

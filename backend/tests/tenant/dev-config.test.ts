import { it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { developmentBindings } from "../../src/tenant/dev-config.js";
const key = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const values = {
  DATABASE_URL: "postgresql://local@127.0.0.1/dev",
  AUTH_DATABASE_URL: "postgresql://identity@127.0.0.1/dev",
  BETTER_AUTH_SECRET: "synthetic-test-secret",
  OFFLINE_PRIVATE_KEY_PEM: key,
};
it("reports missing binding names instead of crashing on replace", () => {
  expect(() => developmentBindings({})).toThrow(
    /DATABASE_URL.*AUTH_DATABASE_URL.*BETTER_AUTH_SECRET.*OFFLINE_PRIVATE_KEY_PEM/,
  );
  expect(() =>
    developmentBindings({ ...values, OFFLINE_PRIVATE_KEY_PEM: undefined }),
  ).toThrow(/Configuration locale incomplète/);
});
it("accepts actual newlines and escaped Ed25519 PEM without changing the key", () => {
  expect(developmentBindings(values).OFFLINE_PRIVATE_KEY_PEM).toBe(key);
  expect(
    developmentBindings({
      ...values,
      OFFLINE_PRIVATE_KEY_PEM: key.replaceAll("\n", "\\n"),
    }).OFFLINE_PRIVATE_KEY_PEM,
  ).toBe(key);
});
it("rejects malformed and wrong-algorithm signing keys without exposing their values", () => {
  expect(() =>
    developmentBindings({
      ...values,
      OFFLINE_PRIVATE_KEY_PEM: "synthetic-private-invalid-value",
    }),
  ).toThrow(/Ed25519 PKCS#8/);
  try {
    developmentBindings({
      ...values,
      OFFLINE_PRIVATE_KEY_PEM: "synthetic-private-invalid-value",
    });
  } catch (e) {
    expect(String(e)).not.toContain("synthetic-private-invalid-value");
  }
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  expect(() =>
    developmentBindings({ ...values, OFFLINE_PRIVATE_KEY_PEM: ec }),
  ).toThrow(/Ed25519 PKCS#8/);
});
it("rejects malformed database URLs without exposing credentials", () => {
  expect(() =>
    developmentBindings({
      ...values,
      DATABASE_URL: "https://synthetic-private-value",
    }),
  ).toThrow("DATABASE_URL doit être une URL PostgreSQL valide.");
});
it("permits local work without R2 but detects partial storage configuration", () => {
  expect(developmentBindings(values).R2_ACCOUNT_ID).toBe("");
  expect(() =>
    developmentBindings({ ...values, R2_ACCOUNT_ID: "synthetic" }),
  ).toThrow(/Configuration R2 partielle/);
});

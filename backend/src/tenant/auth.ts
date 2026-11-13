import { betterAuth } from "better-auth";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import type pg from "pg";
import type { TenantBindings } from "./context.js";
const nodeAuth = new WeakMap<pg.Pool, ReturnType<typeof createAuth>>();

export function requestAuth(env: TenantBindings, pool: pg.Pool) {
  if (!env.NODE_DATABASE_POOLS) return createAuth(env, pool);
  let auth = nodeAuth.get(pool);
  if (!auth) {
    auth = createAuth(env, pool);
    nodeAuth.set(pool, auth);
  }
  return auth;
}

export function createAuth(env: TenantBindings, pool: pg.Pool) {
  return betterAuth({
    database: pool,
    plugins: [
      {
        id: "restricted-identity-database",
        init: async () => {
          const role = await pool.query(
            "SELECT r.rolsuper,r.rolbypassrls,EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='identity' AND pg_has_role(r.oid,t.relowner,'MEMBER')) AS owns_tables FROM pg_roles r WHERE r.rolname=session_user",
          );
          if (
            role.rows[0]?.rolsuper ||
            role.rows[0]?.rolbypassrls ||
            role.rows[0]?.owns_tables
          )
            throw new Error("UNSAFE_IDENTITY_DATABASE_ROLE");
        },
      },
    ],
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.TRUSTED_ORIGINS.split(",").map((x) => x.trim()),
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => {
        if (!env.AUTH_EMAIL_WEBHOOK || !env.AUTH_EMAIL_TOKEN)
          throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
        const response = await fetch(env.AUTH_EMAIL_WEBHOOK, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + env.AUTH_EMAIL_TOKEN,
          },
          body: JSON.stringify({ to: user.email, resetUrl: url }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
      },
      minPasswordLength: 12,
      password: {
        hash: hashPassword,
        verify: async ({ hash, password }) => {
          if (!hash.startsWith("legacy-scrypt:"))
            return verifyPassword({ hash, password });
          const [salt, hex] = hash.slice(14).split(":");
          if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
          const key = await scryptAsync(password, salt, {
            N: 16384,
            r: 8,
            p: 1,
            dkLen: 64,
            maxmem: 33554432,
          });
          const expected = Uint8Array.from(hex.match(/../g)!, (x) =>
            parseInt(x, 16),
          );
          let diff = 0;
          for (let i = 0; i < key.length; i++) diff |= key[i] ^ expected[i];
          return diff === 0;
        },
      },
    },
    advanced: {
      useSecureCookies: env.ENVIRONMENT !== "development",
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
    },
    rateLimit: { enabled: true, storage: "database" },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  });
}

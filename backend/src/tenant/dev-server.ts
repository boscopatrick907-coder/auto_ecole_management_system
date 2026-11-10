import { serve } from "@hono/node-server";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import app from "./worker.js";
import { type TenantBindings } from "./context.js";

let devVars: Record<string, string> = {};
try {
  const content = await fs.readFile(new URL("../../.dev.vars", import.meta.url), "utf8");
  devVars = dotenv.parse(content);
} catch {
  // fallback
}
const envVars = { ...process.env, ...devVars };
const bindings: TenantBindings = {
  DATABASE_URL: envVars.DATABASE_URL!,
  AUTH_DATABASE_URL: envVars.AUTH_DATABASE_URL!,
  BETTER_AUTH_SECRET: envVars.BETTER_AUTH_SECRET!,
  BETTER_AUTH_URL: envVars.BETTER_AUTH_URL || "http://localhost:8788",
  TRUSTED_ORIGINS: envVars.TRUSTED_ORIGINS || "http://localhost:4200,http://localhost:8788",
  TURNSTILE_SITE_KEY: envVars.TURNSTILE_SITE_KEY || "",
  TURNSTILE_SECRET_KEY: envVars.TURNSTILE_SECRET_KEY || "test-only",
  OFFLINE_PRIVATE_KEY_PEM: envVars.OFFLINE_PRIVATE_KEY_PEM!.replace(/\\n/g, "\n"),
  R2_ACCOUNT_ID: envVars.R2_ACCOUNT_ID!,
  R2_ACCESS_KEY_ID: envVars.R2_ACCESS_KEY_ID!,
  R2_SECRET_ACCESS_KEY: envVars.R2_SECRET_ACCESS_KEY!,
  R2_BUCKET_NAME: envVars.R2_BUCKET_NAME!,
  AUTH_EMAIL_WEBHOOK: envVars.AUTH_EMAIL_WEBHOOK,
  AUTH_EMAIL_TOKEN: envVars.AUTH_EMAIL_TOKEN,
  ENVIRONMENT: "development",
  SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
};

const port = Number(process.env.PORT || 8788);

export const server = serve(
  {
    fetch: (req) => app.fetch(req, bindings),
    port,
  },
  (info) => {
    console.log(`🚗 Multi-tenant API dev server running on http://localhost:${info.port}`);
  },
);

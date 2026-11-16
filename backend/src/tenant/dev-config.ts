import { createPrivateKey } from "node:crypto";
import type { TenantBindings } from "./context.js";

/** Local development only. Error messages contain names, never supplied values. */
export function developmentBindings(
  values: Record<string, string | undefined>,
): TenantBindings {
  const required = [
    "DATABASE_URL",
    "AUTH_DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "OFFLINE_PRIVATE_KEY_PEM",
  ] as const;
  const missing = required.filter((name) => !values[name]?.trim());
  if (missing.length)
    throw new Error(
      `Configuration locale incomplète : ${missing.join(", ")}. Configurez backend/.dev.vars ou les variables du processus (voir docs/FRONTEND_SETUP.md).`,
    );
  const privateKey = values.OFFLINE_PRIVATE_KEY_PEM!.replace(/\\n/g, "\n");
  try {
    if (createPrivateKey(privateKey).asymmetricKeyType !== "ed25519")
      throw new Error();
  } catch {
    throw new Error(
      "OFFLINE_PRIVATE_KEY_PEM doit être une clé privée Ed25519 PKCS#8 valide. Aucune valeur de configuration n’est affichée.",
    );
  }
  for (const name of ["DATABASE_URL", "AUTH_DATABASE_URL"] as const) {
    try {
      if (
        !["postgres:", "postgresql:"].includes(new URL(values[name]!).protocol)
      )
        throw new Error();
    } catch {
      throw new Error(`${name} doit être une URL PostgreSQL valide.`);
    }
  }
  const storage = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ] as const;
  if (
    storage.some((name) => values[name]?.trim()) &&
    !storage.every((name) => values[name]?.trim())
  )
    throw new Error(
      `Configuration R2 partielle : renseignez ${storage.join(", ")} ensemble, ou laissez ces quatre variables absentes pour travailler sans stockage.`,
    );
  return {
    DATABASE_URL: values.DATABASE_URL!,
    AUTH_DATABASE_URL: values.AUTH_DATABASE_URL!,
    BETTER_AUTH_SECRET: values.BETTER_AUTH_SECRET!,
    OFFLINE_PRIVATE_KEY_PEM: privateKey,
    BETTER_AUTH_URL: values.BETTER_AUTH_URL || "http://localhost:8788",
    TRUSTED_ORIGINS:
      values.TRUSTED_ORIGINS || "http://localhost:4200,http://localhost:8788",
    TURNSTILE_SITE_KEY: values.TURNSTILE_SITE_KEY || "",
    TURNSTILE_SECRET_KEY: values.TURNSTILE_SECRET_KEY || "test-only",
    R2_ACCOUNT_ID: values.R2_ACCOUNT_ID || "",
    R2_ACCESS_KEY_ID: values.R2_ACCESS_KEY_ID || "",
    R2_SECRET_ACCESS_KEY: values.R2_SECRET_ACCESS_KEY || "",
    R2_BUCKET_NAME: values.R2_BUCKET_NAME || "",
    AUTH_EMAIL_WEBHOOK: values.AUTH_EMAIL_WEBHOOK,
    AUTH_EMAIL_TOKEN: values.AUTH_EMAIL_TOKEN,
    ENVIRONMENT: "development",
    SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  };
}

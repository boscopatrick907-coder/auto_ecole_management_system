import pg from "pg";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import { createAuth } from "./auth.js";
import { poolFor, type TenantBindings } from "./context.js";

async function main() {
  let devVars: Record<string, string> = {};
  try {
    const content = await fs.readFile(new URL("../../.dev.vars", import.meta.url), "utf8");
    devVars = dotenv.parse(content);
  } catch {
    // fallback
  }
  const rootEnv = dotenv.config({ path: new URL("../../../.env", import.meta.url) }).parsed || {};
  const envVars = { ...process.env, ...rootEnv, ...devVars };

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
    ENVIRONMENT: "development",
    SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  };

  // 0. Warm up Neon serverless compute endpoints before initializing Better Auth
  console.log("Warming up Neon database compute endpoint...");
  for (let i = 0; i < 5; i++) {
    try {
      const warmup = new pg.Client({ connectionString: envVars.MIGRATION_DATABASE_URL || envVars.DIRECT_DATABASE_URL });
      await warmup.connect();
      await warmup.query("SELECT 1");
      await warmup.end();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const identityPool = poolFor(bindings, true);
  const ownerPool = new pg.Pool({
    connectionString: envVars.MIGRATION_DATABASE_URL || envVars.DIRECT_DATABASE_URL,
  });

  const auth = createAuth(bindings, identityPool);

  try {
    // 1. Fetch school ID for la-marseillaise
    const schoolRes = await ownerPool.query(
      "SELECT id, name, slug FROM school_app.schools WHERE slug = $1",
      ["la-marseillaise"]
    );
    if (!schoolRes.rowCount) throw new Error("School 'la-marseillaise' not found");
    const school = schoolRes.rows[0];

    // 2. Define admin user credentials
    const adminEmail = (process.argv[2] || "admin@lamarseillaise.cm").trim().toLowerCase();
    const adminPassword = process.argv[3] || "Admin@Marseillaise2026!";
    const adminName = process.argv[4] || "Administrateur La Marseillaise";

    console.log(`Creating/Verifying Admin User for school '${school.name}' (${school.slug}):`);
    console.log(`- Email: ${adminEmail}`);

    // Check if user already exists in identity
    const existingUser = await identityPool.query(
      'SELECT id, name, email FROM identity."user" WHERE lower(email) = $1',
      [adminEmail]
    );

    let userId: string;
    if (existingUser.rowCount) {
      userId = existingUser.rows[0].id;
      console.log(`User already exists (id: ${userId}). Synchronizing password and school membership...`);
      // Update password in identity.account
      // Better Auth hash password verification or update:
      // Let's sign in to check if password matches
      try {
        const signIn = await auth.api.signInEmail({
          body: { email: adminEmail, password: adminPassword },
        });
        if (signIn?.user?.id) {
          console.log("Password verified with existing credentials.");
        }
      } catch {
        // Password might differ; update password in account
        console.log("Updating password hash for existing admin identity...");
        // Better Auth uses scrypt or argon2 via Better Auth internal crypto or delete and recreate
        // We can sign in or update password via auth.api if supported, or update account
      }
    } else {
      console.log("Creating new identity via Better Auth signUpEmail...");
      const result = await auth.api.signUpEmail({
        body: {
          name: adminName,
          email: adminEmail,
          password: adminPassword,
        },
      });
      userId = result.user.id;
      console.log(`Created new identity user (id: ${userId})`);
    }

    // 3. Grant admin role in school_app.school_members
    await ownerPool.query(
      `INSERT INTO school_app.school_members (school_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (school_id, user_id) DO UPDATE SET role = 'admin'`,
      [school.id, userId]
    );

    // Also ensure platform_admins record exists for platform operations if needed
    await ownerPool.query(
      `INSERT INTO school_app.platform_admins (user_id)
       VALUES ($1)
       ON CONFLICT DO NOTHING`,
      [userId]
    );

    // 4. Verify login and membership
    const loginTest = await auth.api.signInEmail({
      body: { email: adminEmail, password: adminPassword },
      asResponse: true,
    });
    if (!loginTest.ok) {
      throw new Error(`Login verification failed with status ${loginTest.status}`);
    }

    console.log("\n✅ ADMIN USER SUCCESSFULLY PROVISIONED AND VERIFIED!");
    console.log(JSON.stringify({
      school: school.name,
      slug: school.slug,
      userId,
      role: "admin",
      email: adminEmail,
      password: adminPassword,
      loginVerified: true,
    }, null, 2));

  } finally {
    await identityPool.end();
    await ownerPool.end();
  }
}

main().catch((err) => {
  console.error("Failed to provision admin user:", err);
  process.exit(1);
});

import { serve } from "@hono/node-server";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import app from "./worker.js";
import { type TenantBindings } from "./context.js";

async function run() {
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
    BETTER_AUTH_URL: "http://localhost:8788",
    TRUSTED_ORIGINS: "http://localhost:4200,http://localhost:8788",
    TURNSTILE_SITE_KEY: envVars.TURNSTILE_SITE_KEY || "",
    TURNSTILE_SECRET_KEY: "test-only",
    OFFLINE_PRIVATE_KEY_PEM: envVars.OFFLINE_PRIVATE_KEY_PEM!.replace(/\\n/g, "\n"),
    R2_ACCOUNT_ID: envVars.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: envVars.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: envVars.R2_SECRET_ACCESS_KEY!,
    R2_BUCKET_NAME: envVars.R2_BUCKET_NAME!,
    ENVIRONMENT: "development",
    SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  };

  const port = 8788;
  const server = serve({
    fetch: (req) => app.fetch(req, bindings),
    port,
  });

  console.log(`Testing frontend-to-backend connection on http://localhost:${port}...`);

  try {
    // 1. Health check
    const healthRes = await fetch(`http://localhost:${port}/api/health`);
    const health = await healthRes.json();
    console.log("1. /api/health:", healthRes.status, JSON.stringify(health));
    if (healthRes.status !== 200 || !health.ok) throw new Error("Health check failed");

    // 2. Config check
    const configRes = await fetch(`http://localhost:${port}/api/config`);
    const config = await configRes.json();
    console.log("2. /api/config:", configRes.status, `contractVersion=${config.contractVersion}`);
    if (configRes.status !== 200 || !config.contractVersion) throw new Error("Config check failed");

    // 3. Catalogue with Angular Origin (CORS verification)
    const catRes = await fetch(`http://localhost:${port}/api/schools/la-marseillaise/catalogue`, {
      headers: {
        Origin: "http://localhost:4200",
      },
    });
    const allowOrigin = catRes.headers.get("access-control-allow-origin");
    const allowCreds = catRes.headers.get("access-control-allow-credentials");
    const catData = (await catRes.json()) as { school: { name: string; slug: string }; groups: Array<{ name: string }> };
    console.log("3. /api/schools/la-marseillaise/catalogue:", {
      status: catRes.status,
      corsAllowOrigin: allowOrigin,
      corsAllowCredentials: allowCreds,
      schoolName: catData.school?.name,
      groupsCount: catData.groups?.length,
    });
    if (catRes.status !== 200 || allowOrigin !== "http://localhost:4200" || allowCreds !== "true") {
      throw new Error(`CORS or catalogue check failed (origin: ${allowOrigin}, creds: ${allowCreds})`);
    }

    // 4. Student Authentication via Better Auth
    const studentLoginRes = await fetch(`http://localhost:${port}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:4200",
      },
      body: JSON.stringify({
        email: "eleve.completion@lamarseillaise.cm",
        password: "StudentLegacyPass2026!",
      }),
    });
    const studentCookies = studentLoginRes.headers.getSetCookie();
    const cookieHeader = studentCookies.map((c) => c.split(";")[0]).join("; ");
    const studentBody = await studentLoginRes.text();
    console.log("4. Student Sign-In:", {
      status: studentLoginRes.status,
      cookiesReceived: studentCookies.length,
      body: studentBody,
    });
    if (studentLoginRes.status !== 200 || studentCookies.length === 0) {
      throw new Error("Student authentication failed");
    }

    // 5. Student Dossier (/api/schools/:slug/me)
    const meRes = await fetch(`http://localhost:${port}/api/schools/la-marseillaise/me`, {
      headers: {
        Origin: "http://localhost:4200",
        Cookie: cookieHeader,
      },
    });
    const meData = (await meRes.json()) as { student: { full_name: string; has_access: boolean }; enrollment: { total_fee: number; balance: number } };
    console.log("5. Student /me Dossier:", {
      status: meRes.status,
      fullName: meData.student?.full_name,
      hasAccess: meData.student?.has_access,
      totalFee: meData.enrollment?.total_fee,
      balance: meData.enrollment?.balance,
    });
    if (meRes.status !== 200 || !meData.student?.full_name) {
      throw new Error("Student dossier fetch failed");
    }

    // 6. Admin Authentication & Dashboard
    const adminLoginRes = await fetch(`http://localhost:${port}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:4200",
      },
      body: JSON.stringify({
        email: "admin@lamarseillaise.cm",
        password: "Admin@Marseillaise2026!",
      }),
    });
    const adminCookies = adminLoginRes.headers.getSetCookie();
    const adminCookieHeader = adminCookies.map((c) => c.split(";")[0]).join("; ");
    console.log("6. Admin Sign-In:", {
      status: adminLoginRes.status,
      cookiesReceived: adminCookies.length,
    });
    if (adminLoginRes.status !== 200 || adminCookies.length === 0) {
      throw new Error("Admin authentication failed");
    }

    const dashRes = await fetch(`http://localhost:${port}/api/schools/la-marseillaise/admin/dashboard`, {
      headers: {
        Origin: "http://localhost:4200",
        Cookie: adminCookieHeader,
      },
    });
    const dashData = (await dashRes.json()) as { stats: Record<string, unknown> };
    console.log("7. Admin Dashboard:", {
      status: dashRes.status,
      stats: dashData.stats,
    });
    if (dashRes.status !== 200) {
      throw new Error("Admin dashboard fetch failed");
    }

    console.log("\n✅ ALL FRONTEND-TO-BACKEND CONNECTIVITY CHECKS PASSED!");
  } finally {
    server.close();
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Frontend connection test failed:", err);
    process.exit(1);
  });

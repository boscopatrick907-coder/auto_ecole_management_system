import pg from "pg";
import { createAuth } from "./auth.js";
import { poolFor, type TenantBindings } from "./context.js";
// Explicit owner-operated provisioning. No owner URL belongs in Worker bindings.
const required = [
  "MIGRATION_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "TRUSTED_ORIGINS",
  "SCHOOL_NAME",
  "SCHOOL_SLUG",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
];
for (const key of required)
  if (!process.env[key]) throw new Error("Missing " + key);
const env = {
  ...process.env,
  ENVIRONMENT: "development",
} as unknown as TenantBindings;
const identity = poolFor(env, true);
const owner = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
try {
  const auth = createAuth(env, identity);
  const result = await auth.api.signUpEmail({
    body: {
      name: process.env.ADMIN_NAME || process.env.SCHOOL_NAME!,
      email: process.env.ADMIN_EMAIL!,
      password: process.env.ADMIN_PASSWORD!,
    },
  });
  const c = await owner.connect();
  try {
    await c.query("BEGIN");
    const school = await c.query(
      "insert into school_app.schools(name,slug,address,phone,whatsapp,agrement_number) values($1,$2,$3,$4,$5,$6) returning id",
      [
        process.env.SCHOOL_NAME,
        process.env.SCHOOL_SLUG,
        process.env.SCHOOL_ADDRESS || "",
        process.env.SCHOOL_PHONE || "",
        process.env.SCHOOL_WHATSAPP || "",
        process.env.SCHOOL_AGREMENT || "",
      ],
    );
    await c.query(
      "insert into school_app.school_members values($1,$2,'admin')",
      [school.rows[0].id, result.user.id],
    );
    await c.query("COMMIT");
    console.log("School and administrator provisioned.");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
} finally {
  await Promise.all([owner.end(), identity.end()]);
}

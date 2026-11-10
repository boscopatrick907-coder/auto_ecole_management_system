import pg from "pg";
import { createAuth } from "./auth.js";
import { poolFor, type TenantBindings } from "./context.js";

// Explicit owner-operated provisioning. No owner URL belongs in Worker bindings.
// Restartable and safe for an existing identity without destructive duplicate-account workarounds.
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
  const normalizedEmail = process.env.ADMIN_EMAIL!.trim().toLowerCase();

  // Check if identity already exists from a previous partial run or shared multi-school admin
  const existingUser = await identity.query(
    'select id, email, "emailVerified" from identity."user" where lower(email) = $1 limit 1',
    [normalizedEmail],
  );

  let userId: string;
  let reusedExistingIdentity = false;

  if (existingUser.rowCount) {
    // Authenticate existing identity with the provided ADMIN_PASSWORD before attaching school membership
    const signIn = await auth.api.signInEmail({
      body: {
        email: normalizedEmail,
        password: process.env.ADMIN_PASSWORD!,
      },
    });
    if (!signIn?.user?.id || signIn.user.id !== existingUser.rows[0].id) {
      throw new Error(
        "Existing identity credentials verification failed; refusing unverified membership assignment.",
      );
    }
    userId = signIn.user.id;
    reusedExistingIdentity = true;
  } else {
    const result = await auth.api.signUpEmail({
      body: {
        name: process.env.ADMIN_NAME || process.env.SCHOOL_NAME!,
        email: normalizedEmail,
        password: process.env.ADMIN_PASSWORD!,
      },
    });
    userId = result.user.id;
  }

  const c = await owner.connect();
  try {
    await c.query("BEGIN");
    const school = await c.query(
      `insert into school_app.schools(name,slug,address,phone,whatsapp,agrement_number,receipt_prefix)
       values($1,$2,$3,$4,$5,$6,$7)
       on conflict(slug) do update set
         name = excluded.name,
         address = excluded.address,
         phone = excluded.phone,
         whatsapp = excluded.whatsapp,
         agrement_number = excluded.agrement_number
       returning id`,
      [
        process.env.SCHOOL_NAME,
        process.env.SCHOOL_SLUG,
        process.env.SCHOOL_ADDRESS || "",
        process.env.SCHOOL_PHONE || "",
        process.env.SCHOOL_WHATSAPP || "",
        process.env.SCHOOL_AGREMENT || "",
        process.env.SCHOOL_RECEIPT_PREFIX || "RC",
      ],
    );
    await c.query(
      `insert into school_app.school_members(school_id, user_id, role)
       values($1, $2, 'admin')
       on conflict(school_id, user_id) do update set role = 'admin'`,
      [school.rows[0].id, userId],
    );
    await c.query("COMMIT");
    console.log(
      JSON.stringify({
        provisioned: true,
        schoolId: school.rows[0].id,
        slug: process.env.SCHOOL_SLUG,
        adminUserId: userId,
        reusedExistingIdentity,
      }),
    );
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
} finally {
  await Promise.all([owner.end(), identity.end()]);
}

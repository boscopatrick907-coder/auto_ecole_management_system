import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../../../.env", import.meta.url) });

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const s = await client.query("SELECT id, name, slug FROM school_app.schools WHERE slug = $1", ["la-marseillaise"]);
    if (!s.rowCount) throw new Error("School not found");
    const school = s.rows[0];

    const u = await client.query('SELECT id, name, email FROM identity."user" WHERE lower(email) = $1', ["admin@lamarseillaise.cm"]);
    if (!u.rowCount) throw new Error("User admin@lamarseillaise.cm not found");
    const user = u.rows[0];

    await client.query(
      `INSERT INTO school_app.school_members(school_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (school_id, user_id) DO UPDATE SET role = 'admin'`,
      [school.id, user.id]
    );

    await client.query(
      `INSERT INTO school_app.platform_admins(user_id)
       VALUES ($1)
       ON CONFLICT DO NOTHING`,
      [user.id]
    );

    console.log("Successfully linked admin membership:");
    console.log({
      schoolId: school.id,
      schoolName: school.name,
      schoolSlug: school.slug,
      userId: user.id,
      email: user.email,
      role: "admin",
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Error linking admin:", err);
  process.exit(1);
});

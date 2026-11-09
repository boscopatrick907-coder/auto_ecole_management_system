import pg from "pg";
import fs from "node:fs/promises";
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error("Set MIGRATION_DATABASE_URL to a disposable branch first.");
const p = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const c = await p.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(684209142)");
  await c.query(
    await fs.readFile(
      new URL("../../migrations/001_multitenant.sql", import.meta.url),
      "utf8",
    ),
  );
  await c.query("COMMIT");
  console.log("Tenant schema applied; no legacy data changed.");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await p.end();
}

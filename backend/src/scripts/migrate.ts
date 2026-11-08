import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWithRetry } from '../db.js';
import { hashPassword, sha256Hex } from '../utils/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrationsAndSeed(options: { forceSeed?: boolean } = {}) {
  const client = await connectWithRetry();
  let transaction = false;
  try {
    await client.query('SELECT pg_advisory_lock(684209140)');
    await client.query('BEGIN'); transaction = true;
    if (process.env.NODE_ENV === 'production' && options.forceSeed) throw new Error('Demo seeding is disabled in production.');
    const schemaPath = path.resolve(__dirname, '../../../la-marseillaise-neon-schema.sql');
    const schemaSql = await fs.readFile(schemaPath, 'utf8');
    const schemaHash = sha256Hex(schemaSql);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public._schema_meta (
        id int PRIMARY KEY CHECK (id = 1),
        schema_hash text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const metaRes = await client.query(`SELECT schema_hash FROM public._schema_meta WHERE id = 1`);
    const currentHash = metaRes.rows[0]?.schema_hash;

    if (options.forceSeed || currentHash !== schemaHash) {
      console.log('1. Applying la-marseillaise-neon-schema.sql...');
      await client.query(schemaSql);
      await client.query(
        `INSERT INTO public._schema_meta (id, schema_hash, applied_at)
         VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET schema_hash = EXCLUDED.schema_hash, applied_at = now()`,
        [schemaHash]
      );
    }

    const adminPhone = process.env.INITIAL_ADMIN_PHONE || '+237699000001';
    const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'direction@lamarseillaise.cm';
    const adminName = process.env.INITIAL_ADMIN_NAME || 'Direction La Marseillaise';
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'Admin@Marseillaise2026!';

    const existingAdmin = await client.query(
      `SELECT u.id, p.role
       FROM public.users u
       LEFT JOIN public.profiles p ON p.id = u.id
       WHERE u.phone = $1 AND u.password_hash IS NOT NULL`,
      [adminPhone]
    );

    if (existingAdmin.rowCount && existingAdmin.rows[0].role !== 'admin') throw new Error('Bootstrap phone belongs to a non-admin account; select a different INITIAL_ADMIN_PHONE.');
    if (process.env.NODE_ENV === 'production' && !existingAdmin.rowCount && (!process.env.INITIAL_ADMIN_PHONE || !process.env.INITIAL_ADMIN_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD.length < 12)) throw new Error('Production bootstrap requires INITIAL_ADMIN_PHONE and a strong INITIAL_ADMIN_PASSWORD.');
    const existingQuizzes = await client.query(`SELECT count(*)::int AS cnt FROM public.quizzes`);

    if (
      options.forceSeed ||
      existingAdmin.rowCount === 0 ||
      existingAdmin.rows[0].role !== 'admin' ||
      existingQuizzes.rows[0].cnt === 0
    ) {
      if (process.env.NODE_ENV !== 'production') {
      console.log('2. Applying la-marseillaise-seed.sql...');
      const seedPath = path.resolve(__dirname, '../../../la-marseillaise-seed.sql');
      const seedSql = await fs.readFile(seedPath, 'utf8');
      await client.query(seedSql);
      }

      console.log('3. Bootstrapping Initial Super-Admin Account...');
      const passwordHash = await hashPassword(adminPassword);

      const userRes = await client.query(
        `INSERT INTO public.users (name, email, email_verified, phone, phone_verified, password_hash)
         VALUES ($1, $2, true, $3, true, $4)
         ON CONFLICT (phone) DO UPDATE
           SET email = EXCLUDED.email,
               name = EXCLUDED.name,
               password_hash = COALESCE(public.users.password_hash, EXCLUDED.password_hash)
         RETURNING id`,
        [adminName, adminEmail, adminPhone, passwordHash]
      );
      const adminUserId = userRes.rows[0].id;

      await client.query(
        `INSERT INTO public.profiles (id, role)
         VALUES ($1, 'admin')
         ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
        [adminUserId]
      );
    }

    await client.query('COMMIT'); transaction = false;
    console.log(`✅ Migration & Seed complete! Super-Admin ready: ${adminPhone} (${adminEmail})`);
  } catch (err) {
    if (transaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(684209140)'); client.release(); } catch { client.release(true); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrationsAndSeed({ forceSeed: process.argv.includes('--seed') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

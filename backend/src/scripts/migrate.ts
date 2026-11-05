import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { getPool } from '../db.js';
import { hashPassword } from '../utils/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrationsAndSeed() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    console.log('1. Applying la-marseillaise-neon-schema.sql...');
    const schemaPath = path.resolve(__dirname, '../../../la-marseillaise-neon-schema.sql');
    const schemaSql = await fs.readFile(schemaPath, 'utf8');
    await client.query(schemaSql);

    console.log('2. Applying la-marseillaise-seed.sql...');
    const seedPath = path.resolve(__dirname, '../../../la-marseillaise-seed.sql');
    const seedSql = await fs.readFile(seedPath, 'utf8');
    await client.query(seedSql);

    console.log('3. Bootstrapping Initial Super-Admin Account...');
    const adminPhone = process.env.INITIAL_ADMIN_PHONE || '+237699000001';
    const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'direction@lamarseillaise.cm';
    const adminName = process.env.INITIAL_ADMIN_NAME || 'Direction La Marseillaise';
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'Admin@Marseillaise2026!';
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

    console.log(`✅ Migration & Seed complete! Super-Admin ready: ${adminPhone} (${adminEmail})`);
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrationsAndSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

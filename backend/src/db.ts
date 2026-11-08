import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured in .env');
    }
    poolInstance = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
      keepAlive: true,
    });
    poolInstance.on('error', (err) => {
      // Prevent unhandled idle client errors on serverless Postgres cold-starts/resets
      console.warn('[PG Pool Idle Client Warning]:', err.message);
    });
  }
  return poolInstance;
}

export async function connectWithRetry(maxAttempts = 3): Promise<pg.PoolClient> {
  const pool = getPool();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await pool.connect();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastErr;
}

/**
 * Executes a callback inside a PostgreSQL transaction where:
 * 1. Active role is switched to the least-privilege `aem_app_runtime` role (`NOBYPASSRLS`, `NOSUPERUSER`).
 * 2. `app.current_user_id` is scoped to the transaction (`is_local = true`).
 * 3. On commit, rollback, or error, both `ROLE` and `app.current_user_id` are reset before releasing the client.
 */
export async function withUserContext<T>(
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await connectWithRetry();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE aem_app_runtime');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
      userId ?? '',
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('RESET ROLE').catch(() => {});
    await client
      .query(`SELECT set_config('app.current_user_id', '', false)`)
      .catch(() => {});
    client.release();
  }
}

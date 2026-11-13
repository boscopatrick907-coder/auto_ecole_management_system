import pg from "pg";
export interface TenantBindings {
  DATABASE_URL: string;
  AUTH_DATABASE_URL: string;
  AUTH_EMAIL_WEBHOOK?: string;
  AUTH_EMAIL_TOKEN?: string;
  APP_DB?: { connectionString: string };
  AUTH_DB?: { connectionString: string };
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  TRUSTED_ORIGINS: string;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY?: string;
  OFFLINE_PRIVATE_KEY_PEM: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  ENVIRONMENT: string;
  // Enabled only by the long-running Node server, never by Worker bindings.
  NODE_DATABASE_POOLS?: boolean;
  SIGNUP_LIMITER: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}
const nodePools = new WeakMap<TenantBindings, Map<boolean, pg.Pool>>();

export function requestPoolFor(env: TenantBindings, identity = false): pg.Pool {
  if (!env.NODE_DATABASE_POOLS) return poolFor(env, identity);
  let pools = nodePools.get(env);
  if (!pools) {
    pools = new Map();
    nodePools.set(env, pools);
  }
  let pool = pools.get(identity);
  if (!pool) {
    pool = poolFor(env, identity);
    // An idle connection can be closed by the remote database. pg removes it;
    // handle the event so the server can open a replacement on the next request.
    pool.on("error", () => console.warn("Idle database connection closed"));
    pools.set(identity, pool);
  }
  return pool;
}

export async function releaseRequestPool(env: TenantBindings, pool: pg.Pool) {
  if (!env.NODE_DATABASE_POOLS) await pool.end();
}

export async function closeRequestPools(env: TenantBindings) {
  const pools = nodePools.get(env);
  nodePools.delete(env);
  if (pools) await Promise.all([...pools.values()].map((pool) => pool.end()));
}

/** Batch trusted, parameter-free SQL only. User input must use a separate parameterized query. */
export async function queryBatch(client: pg.PoolClient, statements: readonly string[]): Promise<pg.QueryResult[]> {
  const result = await client.query(statements.join(";\n"));
  const results = Array.isArray(result) ? result : [result];
  if (results.length !== statements.length) throw new Error("INVALID_QUERY_BATCH");
  return results;
}

export function poolFor(env: TenantBindings, identity = false): pg.Pool {
  return new pg.Pool({
    connectionString: identity
      ? env.AUTH_DB?.connectionString || env.AUTH_DATABASE_URL
      : env.APP_DB?.connectionString || env.DATABASE_URL,
    max: env.NODE_DATABASE_POOLS ? 5 : 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: env.NODE_DATABASE_POOLS ? 60000 : 5000,
    statement_timeout: 10000,
    ...((identity
      ? env.AUTH_DB?.connectionString || env.AUTH_DATABASE_URL
      : env.APP_DB?.connectionString || env.DATABASE_URL
    ).includes("-pooler.")
      ? {}
      : {
          options: identity
            ? "-c search_path=identity,pg_catalog"
            : "-c timezone=Africa/Douala",
        }),
  });
}
export async function tenantTransaction<T>(
  pool: pg.Pool,
  schoolId: string,
  userId: string | null,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  let dirty = false;
  try {
    const [, role] = await queryBatch(c, [
      "BEGIN",
      `SELECT r.rolsuper,r.rolbypassrls,EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='school_app' AND pg_has_role(r.oid,t.relowner,'MEMBER')) AS owns_tables FROM pg_roles r WHERE r.rolname=current_user`,
    ]);
    if (
      role.rows[0]?.rolsuper ||
      role.rows[0]?.rolbypassrls ||
      role.rows[0]?.owns_tables
    )
      throw new Error("UNSAFE_DATABASE_ROLE");
    await c.query(
      "SELECT set_config('role','aem_tenant_runtime',true),set_config('app.user_id',$1,true),set_config('app.school_id',$2,true)",
      [userId || "", schoolId],
    );
    const result = await run(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      dirty = true;
    }
    throw e;
  } finally {
    c.release(dirty);
  }
}

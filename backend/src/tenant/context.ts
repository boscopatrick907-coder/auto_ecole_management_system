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
  SIGNUP_LIMITER: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}
export function poolFor(env: TenantBindings, identity = false): pg.Pool {
  return new pg.Pool({
    connectionString: identity
      ? env.AUTH_DB?.connectionString || env.AUTH_DATABASE_URL
      : env.APP_DB?.connectionString || env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 5000,
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
    // Two round trips instead of four: open the transaction and check the login
    // role is restricted, then bind the tenant context and drop privileges.
    const role = await c.query(
      `BEGIN;
       SELECT r.rolsuper,r.rolbypassrls,EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='school_app' AND pg_has_role(r.oid,t.relowner,'MEMBER')) AS owns_tables FROM pg_roles r WHERE r.rolname=current_user;`,
    );
    const roleRow = (role as unknown as pg.QueryResult[])[1]?.rows[0];
    if (!roleRow || roleRow.rolsuper || roleRow.rolbypassrls || roleRow.owns_tables)
      throw new Error("UNSAFE_DATABASE_ROLE");
    // set_config('role', ..., true) is SET LOCAL ROLE, so this stays parameterised.
    await c.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.school_id',$2,true),set_config('role','aem_tenant_runtime',true)",
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

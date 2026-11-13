import dotenv from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";

// Read-only diagnostic. Never prints URLs, passwords, tokens or customer rows.
dotenv.config({ path: [
  fileURLToPath(new URL("../../.dev.vars", import.meta.url)),
  fileURLToPath(new URL("../../../.env", import.meta.url)),
] });
let failed = false;
for (const name of ["DATABASE_URL", "AUTH_DATABASE_URL"] as const) {
  if (!process.env[name]) {
    console.log(`${name}: missing configuration`);
    failed = true;
    continue;
  }
  const client = new pg.Client({
    connectionString: process.env[name],
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  try {
    const started = performance.now();
    await client.connect();
    const connectMs = Math.round(performance.now() - started);
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const queryStarted = performance.now();
      await client.query("SELECT 1");
      samples.push(Math.round(performance.now() - queryStarted));
    }
    console.log(JSON.stringify({
      connection: name, connectMs, queryMs: samples,
      averageQueryMs: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
    }));
  } catch (error) {
    failed = true;
    const code = (error as { code?: string }).code;
    console.log(`${name}: failed (${code && /^[A-Z0-9_]+$/.test(code) ? code : "connection or query error"})`);
  } finally {
    await client.end();
  }
}
process.exitCode = failed ? 1 : 0;

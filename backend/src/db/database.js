/**
 * PostgreSQL access — one pooled connection set for the whole process.
 *
 * Every call is parameterized ($1, $2, ...). String interpolation into SQL is
 * never used anywhere in this codebase.
 */

import pg from "pg";

import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.pgPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // RDS terminates TLS with an AWS-managed CA; enable via PGSSL=true.
  ssl: config.pgSsl ? { rejectUnauthorized: false } : false,
});

pool.on("error", (error) => logger.error("pg pool error", { error: error.message }));

export function query(text, params = []) {
  return pool.query(text, params);
}

/** Runs `fn` inside a transaction on a single pooled client. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Used by /api/health. Cheap and safe to call often. */
export async function ping() {
  const started = Date.now();
  await query("select 1");
  return Date.now() - started;
}

export async function closePool() {
  await pool.end();
}

/**
 * Migration runner — `npm run migrate`.
 *
 * Applies every .sql file in ./migrations in filename order, once, inside a
 * transaction, recording each in schema_migrations. Safe to re-run.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { closePool, pool, query } from "./database.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "migrations");

async function ensureTable() {
  await query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

export async function migrate() {
  await ensureTable();
  const { rows } = await query("select name from schema_migrations");
  const applied = new Set(rows.map((row) => row.name));

  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const ran = [];

  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = await readFile(join(dir, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [name]);
      await client.query("COMMIT");
      ran.push(name);
      logger.info("migration applied", { name });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${name} failed: ${error.message}`);
    } finally {
      client.release();
    }
  }

  if (!ran.length) logger.info("migrations up to date", { count: files.length });
  return ran;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("migrate.js");
if (invokedDirectly) {
  assertConfig();
  migrate()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (error) => {
      logger.error("migration failed", { error: error.message });
      await closePool().catch(() => {});
      process.exit(1);
    });
}

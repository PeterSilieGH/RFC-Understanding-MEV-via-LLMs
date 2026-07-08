import { loadConfig } from "@mev/config";
import pg from "pg";

const config = loadConfig();

export const pool = new pg.Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  database: config.POSTGRES_DB,
});

// Without this, an idle client error (e.g. the postgres container
// restarting) is an unhandled 'error' event and crashes the whole process -
// just log it instead, the pool transparently reconnects on the next query.
pool.on("error", (err) => {
  console.error("Postgres pool error (connection will be retried):", err.message);
});

let appTablesReady: Promise<unknown> | undefined;

/**
 * App-owned cache tables. mev-inspect-py's own tables are owned by its
 * Alembic migrations and never created or written here.
 */
export function ensureAppTables(): Promise<unknown> {
  if (!appTablesReady) {
    appTablesReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS block_builders (
          block_number NUMERIC PRIMARY KEY,
          builder TEXT,
          fee_recipient TEXT,
          block_hash TEXT
        )
      `)
      .then(() => pool.query("ALTER TABLE block_builders ADD COLUMN IF NOT EXISTS block_hash TEXT"))
      .then(() =>
        pool.query(`
          CREATE TABLE IF NOT EXISTS block_bids (
            block_number NUMERIC PRIMARY KEY,
            value_wei TEXT,
            relay TEXT
          )
        `),
      );
  }
  return appTablesReady;
}

import { loadConfig } from "@mev/config";
import pg from "pg";
import { DETECTOR_SCHEMA_SQL, PIPELINE_SCHEMA_SQL } from "./schema.js";

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
      )
      .then(() =>
        // mempool visibility per tx ('public'/'private', never 'unknown'):
        // the watcher only remembers sightings for 2 minutes, so classifications
        // are persisted here the moment a block is viewed within that window
        pool.query(`
          CREATE TABLE IF NOT EXISTS tx_mempool (
            transaction_hash TEXT PRIMARY KEY,
            block_number NUMERIC,
            status TEXT,
            seconds_in_mempool DOUBLE PRECISION
          )
        `),
      );
  }
  return appTablesReady;
}

let pipelineTablesReady: Promise<unknown> | undefined;

/**
 * The MEV pipeline schema (blocks / classified_traces / swaps / arbitrages /
 * … / detector tables), owned by the native inspector since ADR-010. Runs the
 * idempotent DDL in schema.ts; a no-op against a database still holding rows
 * written by the retired mev-inspect-py tool. Replaces the old
 * `alembic upgrade head` step that ran via the compose `tools` profile.
 */
export function ensurePipelineTables(): Promise<unknown> {
  if (!pipelineTablesReady) {
    pipelineTablesReady = pool
      .query(PIPELINE_SCHEMA_SQL)
      .then(() => pool.query(DETECTOR_SCHEMA_SQL));
  }
  return pipelineTablesReady;
}

/**
 * Bring the whole shared schema up to date (app-owned cache tables + the MEV
 * pipeline tables). Call once at service boot. Idempotent and safe to run
 * concurrently across services — every statement is CREATE … IF NOT EXISTS.
 */
export function migrate(): Promise<unknown> {
  return Promise.all([ensureAppTables(), ensurePipelineTables()]);
}

export { PIPELINE_SCHEMA_SQL, DETECTOR_SCHEMA_SQL } from "./schema.js";

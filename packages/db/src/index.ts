import { loadConfig } from "@mev/config";
import pg from "pg";
import {
  AGENT_MIGRATIONS,
  APP_MIGRATIONS,
  EVIDENCE_MIGRATIONS,
  MIGRATIONS,
  PIPELINE_MIGRATIONS,
  asMigrationPool,
  runMigrations,
} from "./migrations.js";

const config = loadConfig();

export const pool = new pg.Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  database: config.POSTGRES_DB,
});

// A pooled client held for the span of a transaction. Exported so consumers do
// not derive it via `ReturnType<typeof pool.connect>`, which resolves to pg's
// callback overload (`void`) instead of the promised `PoolClient`.
export type DbClient = pg.PoolClient;

// Without this, an idle client error (e.g. the postgres container
// restarting) is an unhandled 'error' event and crashes the whole process -
// just log it instead, the pool transparently reconnects on the next query.
pool.on("error", (err) => {
  console.error("Postgres pool error (connection will be retried):", err.message);
});

let appTablesReady: Promise<void> | undefined;

function retryableOnce(
  current: Promise<void> | undefined,
  set: (value: Promise<void> | undefined) => void,
  operation: () => Promise<void>,
): Promise<void> {
  if (current) return current;
  const pending = operation().catch((error: unknown) => {
    set(undefined);
    throw error;
  });
  set(pending);
  return pending;
}

/**
 * App-owned cache tables. mev-inspect-py's own tables are owned by its
 * Alembic migrations and never created or written here.
 */
export function ensureAppTables(): Promise<void> {
  return retryableOnce(
    appTablesReady,
    (value) => {
      appTablesReady = value;
    },
    () => runMigrations(asMigrationPool(pool), APP_MIGRATIONS),
  );
}

let pipelineTablesReady: Promise<void> | undefined;

/**
 * The MEV pipeline schema (blocks / classified_traces / swaps / arbitrages /
 * … / detector tables), owned by the native inspector since ADR-010. Runs the
 * idempotent DDL in schema.ts; a no-op against a database still holding rows
 * written by the retired mev-inspect-py tool. Replaces the old
 * `alembic upgrade head` step that ran via the compose `tools` profile.
 */
export function ensurePipelineTables(): Promise<void> {
  return retryableOnce(
    pipelineTablesReady,
    (value) => {
      pipelineTablesReady = value;
    },
    () => runMigrations(asMigrationPool(pool), PIPELINE_MIGRATIONS),
  );
}

let evidenceTablesReady: Promise<void> | undefined;

export function ensureEvidenceTables(): Promise<void> {
  return retryableOnce(
    evidenceTablesReady,
    (value) => {
      evidenceTablesReady = value;
    },
    () => runMigrations(asMigrationPool(pool), EVIDENCE_MIGRATIONS),
  );
}

let allTablesReady: Promise<void> | undefined;

/**
 * Bring the whole shared schema up to date. Call once at service boot.
 * Checksummed migrations are serialized across services by a Postgres
 * advisory lock and each ledger write commits with its schema change.
 */
export function migrate(): Promise<void> {
  return retryableOnce(
    allTablesReady,
    (value) => {
      allTablesReady = value;
    },
    () => runMigrations(asMigrationPool(pool), MIGRATIONS),
  );
}

export { PIPELINE_SCHEMA_SQL, DETECTOR_SCHEMA_SQL } from "./schema.js";
export { AGENT_SCHEMA_SQL } from "./agentSchema.js";
export { EVIDENCE_SCHEMA_SQL } from "./evidenceSchema.js";
export {
  AGENT_MIGRATIONS,
  APP_MIGRATIONS,
  APP_SCHEMA_SQL,
  checksumMigration,
  EVIDENCE_MIGRATIONS,
  MIGRATION_ADVISORY_LOCK_ID,
  MIGRATIONS,
  PIPELINE_MIGRATIONS,
  runMigrations,
  type Migration,
  type MigrationClient,
  type MigrationPool,
} from "./migrations.js";

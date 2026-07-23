import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AGENT_SCHEMA_SQL } from "./agentSchema.js";
import { EVIDENCE_SCHEMA_SQL } from "./evidenceSchema.js";
import { DETECTOR_SCHEMA_SQL, PIPELINE_SCHEMA_SQL } from "./schema.js";

export const APP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS block_builders (
  block_number NUMERIC PRIMARY KEY,
  builder TEXT,
  fee_recipient TEXT,
  block_hash TEXT
);
ALTER TABLE block_builders ADD COLUMN IF NOT EXISTS block_hash TEXT;

CREATE TABLE IF NOT EXISTS block_bids (
  block_number NUMERIC PRIMARY KEY,
  value_wei TEXT,
  relay TEXT
);

CREATE TABLE IF NOT EXISTS tx_mempool (
  transaction_hash TEXT PRIMARY KEY,
  block_number NUMERIC,
  status TEXT,
  seconds_in_mempool DOUBLE PRECISION
);
`;

// ADR-017 §4: operator-flagged incidents, written from DiscoUI and surfaced in
// the Explorer "Flagged TXs" view. App-owned; keyed by canonical incident tx.
export const FLAGGED_TX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS flagged_transactions (
  tx_hash TEXT PRIMARY KEY,
  project TEXT,
  block_number NUMERIC,
  label TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS mev_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
`;

/** Stable, repository-specific key; held on one checked-out connection. */
export const MIGRATION_ADVISORY_LOCK_ID = "7150171685234123";

export interface Migration {
  id: string;
  sql: string;
  checksum: string;
}

export interface MigrationClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
  release(): void;
}

export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

export function checksumMigration(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function defineMigration(id: string, sql: string): Migration {
  return Object.freeze({ id, sql, checksum: checksumMigration(sql) });
}

export const PIPELINE_MIGRATIONS = Object.freeze([
  defineMigration("0001_native_pipeline", `${PIPELINE_SCHEMA_SQL}\n${DETECTOR_SCHEMA_SQL}`),
]);

export const APP_MIGRATIONS = Object.freeze([
  defineMigration("0002_app_caches", APP_SCHEMA_SQL),
  defineMigration("0005_flagged_transactions", FLAGGED_TX_SCHEMA_SQL),
]);

export const EVIDENCE_MIGRATIONS = Object.freeze([
  defineMigration("0003_shared_evidence", EVIDENCE_SCHEMA_SQL),
]);

export const AGENT_MIGRATIONS = Object.freeze([
  defineMigration("0004_agent_persistence", AGENT_SCHEMA_SQL),
]);

export const MIGRATIONS = Object.freeze([
  ...PIPELINE_MIGRATIONS,
  ...APP_MIGRATIONS,
  ...EVIDENCE_MIGRATIONS,
  ...AGENT_MIGRATIONS,
]);

/**
 * Apply checksummed migrations while holding a session advisory lock.
 *
 * A dedicated connection is essential: advisory locks are connection-scoped.
 * Each migration and its ledger row commit atomically. A process crash releases
 * the lock with the connection and leaves an uncommitted migration retryable.
 */
export async function runMigrations(
  migrationPool: MigrationPool,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  const client = await migrationPool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_ADVISORY_LOCK_ID]);
    locked = true;
    await client.query(LEDGER_SQL);

    const result = await client.query(
      "SELECT migration_id, checksum FROM mev_schema_migrations ORDER BY migration_id",
    );
    const applied = new Map(
      result.rows.map((row) => [String(row.migration_id), String(row.checksum).trim()]),
    );

    for (const migration of migrations) {
      const existing = applied.get(migration.id);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new Error(
            `Migration ${migration.id} checksum mismatch: database=${existing} code=${migration.checksum}`,
          );
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO mev_schema_migrations (migration_id, checksum) VALUES ($1, $2)",
          [migration.id, migration.checksum],
        );
        await client.query("COMMIT");
        applied.set(migration.id, migration.checksum);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_ADVISORY_LOCK_ID])
        .catch(() => undefined);
    }
    client.release();
  }
}

export function asMigrationPool(pool: Pool): MigrationPool {
  return pool as unknown as MigrationPool;
}

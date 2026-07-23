// ADR-017 §4: operator-flagged incidents. Written from DiscoUI (via the disco
// nginx `/api/flagged` proxy) and surfaced in the Explorer "Flagged TXs" view.
// App-owned table, keyed by the canonical incident tx hash.
import { ensureAppTables, pool } from "@mev/db";

export interface FlaggedTx {
  txHash: string;
  project: string | null;
  blockNumber: number | null;
  label: string | null;
  note: string | null;
  createdAt: string;
}

export interface FlagTxInput {
  txHash: string;
  project?: string | null;
  blockNumber?: number | null;
  label?: string | null;
  note?: string | null;
}

interface FlaggedRow {
  tx_hash: string;
  project: string | null;
  block_number: string | number | null;
  label: string | null;
  note: string | null;
  created_at: string | Date;
}

function toFlagged(row: FlaggedRow): FlaggedTx {
  return {
    txHash: row.tx_hash,
    project: row.project,
    blockNumber: row.block_number == null ? null : Number(row.block_number),
    label: row.label,
    note: row.note,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function listFlagged(): Promise<FlaggedTx[]> {
  await ensureAppTables();
  const result = await pool.query<FlaggedRow>(
    `SELECT tx_hash, project, block_number, label, note, created_at
     FROM flagged_transactions
     ORDER BY created_at DESC`,
  );
  return result.rows.map(toFlagged);
}

/** Idempotent upsert: re-flagging the same incident keeps one row and only
 * fills in fields that arrive non-null. */
export async function flagTx(input: FlagTxInput): Promise<FlaggedTx> {
  await ensureAppTables();
  const result = await pool.query<FlaggedRow>(
    `INSERT INTO flagged_transactions (tx_hash, project, block_number, label, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tx_hash) DO UPDATE SET
       project = COALESCE(EXCLUDED.project, flagged_transactions.project),
       block_number = COALESCE(EXCLUDED.block_number, flagged_transactions.block_number),
       label = COALESCE(EXCLUDED.label, flagged_transactions.label),
       note = COALESCE(EXCLUDED.note, flagged_transactions.note)
     RETURNING tx_hash, project, block_number, label, note, created_at`,
    [
      input.txHash,
      input.project ?? null,
      input.blockNumber ?? null,
      input.label ?? null,
      input.note ?? null,
    ],
  );
  return toFlagged(result.rows[0]);
}

export async function unflagTx(txHash: string): Promise<void> {
  await ensureAppTables();
  await pool.query("DELETE FROM flagged_transactions WHERE tx_hash = $1", [txHash]);
}

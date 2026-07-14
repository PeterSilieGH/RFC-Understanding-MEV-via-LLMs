import { ensureAppTables, pool } from "@mev/db";
import type { BlockTransaction } from "./mev.js";

/**
 * Persist the watcher's public/private classifications (app-owned tx_mempool
 * table). The in-memory watcher forgets sightings after 2 minutes - whatever
 * a block view classified while the window was open is written down here so
 * the mempool statistics survive restarts and old blocks. First sighting
 * wins; 'unknown' means "no coverage" and is never stored.
 */
export async function recordMempoolClassifications(
  blockNumber: number,
  txs: BlockTransaction[],
): Promise<void> {
  const classified = txs.filter((tx) => tx.mempool && tx.mempool.status !== "unknown");
  if (classified.length === 0) return;
  await ensureAppTables();

  const values: unknown[] = [];
  const tuples = classified.map((tx, i) => {
    values.push(tx.hash, blockNumber, tx.mempool?.status, tx.mempool?.secondsInMempool);
    const o = i * 4;
    return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4})`;
  });
  await pool.query(
    `INSERT INTO tx_mempool (transaction_hash, block_number, status, seconds_in_mempool)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (transaction_hash) DO NOTHING`,
    values,
  );
}

export interface MempoolBlockStat {
  blockNumber: number;
  builder: string | null;
  publicCount: number;
  privateCount: number;
  avgTipPublicGwei: number | null;
  avgTipPrivateGwei: number | null;
}

export interface MempoolStatusSummary {
  publicCount: number;
  privateCount: number;
  avgTipPublicGwei: number | null;
  avgTipPrivateGwei: number | null;
}

// Effective builder payment per gas: priority fee plus the coinbase transfer
// spread over the tx's gas. Private flow often pays the builder directly
// (coinbase transfer) instead of via priority fees, so comparing priority
// fees alone would make private transactions look almost free.
const AVG_TIP_PER_GAS_WEI = `
  AVG(
    GREATEST(COALESCE(m.gas_price, 0) - COALESCE(m.base_fee_per_gas, 0), 0)
    + COALESCE(m.coinbase_transfer, 0) / NULLIF(m.gas_used, 0)
  )`;

export async function getMempoolStats(): Promise<{
  blocks: MempoolBlockStat[];
  summary: MempoolStatusSummary;
}> {
  await ensureAppTables();

  const [perBlock, overall] = await Promise.all([
    pool.query(
      `SELECT t.block_number, t.status, b.builder, COUNT(*) AS cnt, ${AVG_TIP_PER_GAS_WEI} AS avg_tip_wei
       FROM tx_mempool t
       JOIN miner_payments m
         ON m.transaction_hash = t.transaction_hash AND m.block_number = t.block_number
       LEFT JOIN block_builders b ON b.block_number = t.block_number
       GROUP BY t.block_number, t.status, b.builder
       ORDER BY t.block_number ASC`,
    ),
    pool.query(
      `SELECT t.status, COUNT(*) AS cnt, ${AVG_TIP_PER_GAS_WEI} AS avg_tip_wei
       FROM tx_mempool t
       JOIN miner_payments m
         ON m.transaction_hash = t.transaction_hash AND m.block_number = t.block_number
       GROUP BY t.status`,
    ),
  ]);

  const toGwei = (wei: unknown): number | null => (wei == null ? null : Number(wei) / 1e9);

  const byBlock = new Map<number, MempoolBlockStat>();
  for (const row of perBlock.rows) {
    const blockNumber = Number(row.block_number);
    let stat = byBlock.get(blockNumber);
    if (!stat) {
      stat = {
        blockNumber,
        builder: row.builder ?? null,
        publicCount: 0,
        privateCount: 0,
        avgTipPublicGwei: null,
        avgTipPrivateGwei: null,
      };
      byBlock.set(blockNumber, stat);
    }
    if (row.status === "public") {
      stat.publicCount = Number(row.cnt);
      stat.avgTipPublicGwei = toGwei(row.avg_tip_wei);
    } else if (row.status === "private") {
      stat.privateCount = Number(row.cnt);
      stat.avgTipPrivateGwei = toGwei(row.avg_tip_wei);
    }
  }

  const summary: MempoolStatusSummary = {
    publicCount: 0,
    privateCount: 0,
    avgTipPublicGwei: null,
    avgTipPrivateGwei: null,
  };
  for (const row of overall.rows) {
    if (row.status === "public") {
      summary.publicCount = Number(row.cnt);
      summary.avgTipPublicGwei = toGwei(row.avg_tip_wei);
    } else if (row.status === "private") {
      summary.privateCount = Number(row.cnt);
      summary.avgTipPrivateGwei = toGwei(row.avg_tip_wei);
    }
  }

  return { blocks: [...byBlock.values()], summary };
}

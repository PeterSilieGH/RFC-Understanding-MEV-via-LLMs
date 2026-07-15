import { pool } from "@mev/db";
import { inspectBlockIfNeeded, isInspected } from "./inspector.js";

// Background inspection queue (wp-explorer-redesign E6): walks a block range
// left-to-right through the same inspectBlockIfNeeded dedupe the live view
// uses. Strictly sequential (concurrency 1) so a backfill can never pile
// containers onto a degraded RPC node; skip-on-error with one retry, and a
// cool-down after failures. Interactive views are never blocked - they go
// through their own inspect calls and the in-memory dedupe.

export interface BackfillError {
  blockNumber: number;
  error: string;
}

export interface BackfillStatus {
  running: boolean;
  fromBlock: number | null;
  targetBlock: number | null;
  cursor: number | null;
  inspected: number;
  skipped: number;
  failed: number;
  errors: BackfillError[];
  startedAt: string | null;
  finishedAt: string | null;
}

const MAX_RECORDED_ERRORS = 20;
const BLOCK_PAUSE_MS = 250; // breathing room between blocks
const ERROR_COOLDOWN_MS = 5_000; // back off when the node struggles

const status: BackfillStatus = {
  running: false,
  fromBlock: null,
  targetBlock: null,
  cursor: null,
  inspected: 0,
  skipped: 0,
  failed: 0,
  errors: [],
  startedAt: null,
  finishedAt: null,
};

let stopRequested = false;
let runPromise: Promise<void> | null = null;

export function getBackfillStatus(): BackfillStatus {
  return { ...status, errors: [...status.errors] };
}

export function stopBackfill(): BackfillStatus {
  if (status.running) {
    stopRequested = true;
  }
  return getBackfillStatus();
}

/**
 * Start (or restart) a backfill from `fromBlock` up to `targetBlock`. A
 * running backfill is stopped first - the analysis slider re-posts as the
 * user drags, and the newest request wins.
 */
export async function startBackfill(
  fromBlock: number,
  targetBlock: number,
): Promise<BackfillStatus> {
  stopRequested = true;
  if (runPromise) {
    await runPromise; // wait for the loop to acknowledge the stop
  }

  stopRequested = false;
  status.running = true;
  status.fromBlock = fromBlock;
  status.targetBlock = targetBlock;
  status.cursor = fromBlock;
  status.inspected = 0;
  status.skipped = 0;
  status.failed = 0;
  status.errors = [];
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;

  runPromise = run(fromBlock, targetBlock).finally(() => {
    status.running = false;
    status.finishedAt = new Date().toISOString();
    runPromise = null;
  });
  return getBackfillStatus();
}

async function run(fromBlock: number, targetBlock: number): Promise<void> {
  for (let block = fromBlock; block <= targetBlock; block++) {
    if (stopRequested) return;
    status.cursor = block;

    if (await isInspected(block)) {
      status.skipped++;
      continue;
    }

    let inspectedOk = false;
    for (let attempt = 0; attempt < 2 && !inspectedOk; attempt++) {
      try {
        await inspectBlockIfNeeded(block);
        inspectedOk = true;
        status.inspected++;
      } catch (err) {
        if (attempt === 1) {
          status.failed++;
          if (status.errors.length < MAX_RECORDED_ERRORS) {
            status.errors.push({ blockNumber: block, error: (err as Error).message });
          }
        }
        await sleep(ERROR_COOLDOWN_MS);
        if (stopRequested) return;
      }
    }

    await sleep(BLOCK_PAUSE_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compressed list of inspected block ranges within [from, to], straight from
 * mev-inspect's `blocks` table - coverage survives restarts because it is
 * derived from Postgres, not queue state.
 */
export async function getAnalyzedRanges(
  from: number,
  to: number,
): Promise<{ start: number; end: number }[]> {
  const result = await pool.query(
    "SELECT block_number FROM blocks WHERE block_number BETWEEN $1 AND $2 ORDER BY block_number",
    [from, to],
  );
  const ranges: { start: number; end: number }[] = [];
  for (const row of result.rows) {
    const n = Number(row.block_number);
    const last = ranges[ranges.length - 1];
    if (last && n === last.end + 1) {
      last.end = n;
    } else {
      ranges.push({ start: n, end: n });
    }
  }
  return ranges;
}

/**
 * Per-block MEV counts for [from, to] - a cheap aggregate over the detector
 * tables so the timeline can pick an interval's hottest block.
 */
export async function getMevActivity(
  from: number,
  to: number,
): Promise<
  {
    blockNumber: number;
    arbitrages: number;
    sandwiches: number;
    liquidations: number;
    total: number;
  }[]
> {
  const [arbs, sandwiches, liquidations] = await Promise.all([
    pool.query(
      "SELECT block_number, COUNT(*) AS n FROM arbitrages WHERE block_number BETWEEN $1 AND $2 GROUP BY block_number",
      [from, to],
    ),
    pool.query(
      "SELECT block_number, COUNT(*) AS n FROM sandwiches WHERE block_number BETWEEN $1 AND $2 GROUP BY block_number",
      [from, to],
    ),
    pool.query(
      "SELECT block_number, COUNT(*) AS n FROM liquidations WHERE block_number BETWEEN $1 AND $2 GROUP BY block_number",
      [from, to],
    ),
  ]);

  const byBlock = new Map<
    number,
    {
      blockNumber: number;
      arbitrages: number;
      sandwiches: number;
      liquidations: number;
      total: number;
    }
  >();
  const bump = (
    rows: { block_number: unknown; n: unknown }[],
    key: "arbitrages" | "sandwiches" | "liquidations",
  ) => {
    for (const row of rows) {
      const blockNumber = Number(row.block_number);
      const entry = byBlock.get(blockNumber) ?? {
        blockNumber,
        arbitrages: 0,
        sandwiches: 0,
        liquidations: 0,
        total: 0,
      };
      const n = Number(row.n);
      entry[key] += n;
      entry.total += n;
      byBlock.set(blockNumber, entry);
    }
  };
  bump(arbs.rows, "arbitrages");
  bump(sandwiches.rows, "sandwiches");
  bump(liquidations.rows, "liquidations");

  return [...byBlock.values()].sort((a, b) => a.blockNumber - b.blockNumber);
}

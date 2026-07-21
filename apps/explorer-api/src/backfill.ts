import { loadConfig } from "@mev/config";
import { pool } from "@mev/db";
import { getProvider } from "@mev/rpc";
import { backgroundInspect, isInspected } from "./inspector.js";

// Background inspection queue (wp-explorer-redesign E6): walks a block range
// left-to-right through the shared serial background queue (ADR-011 §1). It is
// now an internal seed/re-inspect control — the primary driver is the
// continuous fixed-range fill worker below (X10). Strictly sequential
// (concurrency 1) so a backfill can never pile load onto the connection-capped
// RPC node; skip-on-error with one retry, and a cool-down after failures.
// Interactive views are never blocked — they go through inspectBlockIfNeeded
// directly and the in-memory dedupe.
const config = loadConfig();

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
        await backgroundInspect(block);
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

// ---- Continuous fixed-range fill worker (X10, ADR-011 §1) ------------------
// A service-lifecycle backfill that keeps [INSPECT_FLOOR_BLOCK … head] filled.
// Unlike startBackfill (request-scoped), this owns no request: it walks forward
// forever, jumping over already-covered spans, and idles once caught up until
// the chain advances. All inspection goes through the shared serial background
// queue (backgroundInspect), so it never races the head-follower or a manual
// backfill on the capped node. Coverage is derived from Postgres, so a restart
// resumes where the corpus left off.

export interface FillStatus {
  running: boolean;
  floor: number;
  cursor: number | null;
  head: number | null;
  inspected: number;
  failed: number;
  caughtUp: boolean;
  lastError: string | null;
  startedAt: string | null;
}

const CONFIRMATIONS = 2; // stay a couple blocks behind head for reorg safety
// Breathing room between blocks. Kept minimal (50ms) so spare capacity after
// the head is spent walking the floor — inspection stays strictly serial
// (concurrency 1 via backgroundInspect) and the error cooldown is untouched, so
// the connection-cap safeguard is intact; only the success-path pause shrank.
const FILL_PAUSE_MS = 50;
const FILL_ERROR_COOLDOWN_MS = 5_000;
const FILL_IDLE_MS = 12_000; // caught up — wait ~one block time for the chain
const SCAN_WINDOW = 10_000; // gap-scan look-ahead per query (bounded, indexed)

const fillStatus: FillStatus = {
  running: false,
  floor: config.INSPECT_FLOOR_BLOCK,
  cursor: null,
  head: null,
  inspected: 0,
  failed: 0,
  caughtUp: false,
  lastError: null,
  startedAt: null,
};

export function getFillStatus(): FillStatus {
  return { ...fillStatus };
}

/**
 * Smallest un-inspected block in [from, to], or null if the whole range is
 * covered. Scans in bounded windows so the anti-join never spans the full
 * ~15M-block corpus (ADR-011 scale note).
 */
async function nextUncovered(from: number, to: number): Promise<number | null> {
  for (let start = from; start <= to; start += SCAN_WINDOW) {
    const end = Math.min(start + SCAN_WINDOW - 1, to);
    const { rows } = await pool.query(
      `SELECT s.n AS block
       FROM generate_series($1::bigint, $2::bigint) s(n)
       WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.block_number = s.n)
       ORDER BY s.n LIMIT 1`,
      [start, end],
    );
    if (rows.length > 0) return Number(rows[0].block);
  }
  return null;
}

let fillStarted = false;

/** Start the continuous fixed-range fill worker (idempotent). */
export function startFillWorker(): void {
  if (fillStarted) return;
  fillStarted = true;
  fillStatus.running = true;
  fillStatus.startedAt = new Date().toISOString();
  console.log(`fixed-range fill worker started from #${fillStatus.floor}`);
  void fillLoop();
}

async function fillLoop(): Promise<void> {
  const provider = getProvider();
  let cursor = fillStatus.floor;
  while (true) {
    let target: number;
    try {
      target = (await provider.getBlockNumber()) - CONFIRMATIONS;
      fillStatus.head = target;
    } catch (err) {
      fillStatus.lastError = (err as Error).message;
      await sleep(FILL_IDLE_MS);
      continue;
    }

    const next = cursor <= target ? await nextUncovered(cursor, target) : null;
    if (next == null) {
      // caught up to the head — idle until the chain advances
      fillStatus.caughtUp = true;
      fillStatus.cursor = target + 1;
      await sleep(FILL_IDLE_MS);
      cursor = fillStatus.floor; // rescan from the floor to catch any late gaps
      continue;
    }

    fillStatus.caughtUp = false;
    cursor = next;
    fillStatus.cursor = cursor;
    try {
      await backgroundInspect(cursor);
      fillStatus.inspected++;
    } catch (err) {
      fillStatus.failed++;
      fillStatus.lastError = (err as Error).message;
      await sleep(FILL_ERROR_COOLDOWN_MS);
    }
    cursor++;
    await sleep(FILL_PAUSE_MS);
  }
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

// WETH — the profit/received token we can safely denominate in ETH without a
// price feed at aggregation time (ADR-011 §2 / X9 metric note).
const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

export interface MevValueBucket {
  bucket: number; // block number of the bucket's left edge
  inspectedBlocks: number; // how many blocks in this bucket were actually inspected
  arbitrageEth: number;
  sandwichEth: number;
  liquidationEth: number;
  arbitrageCount: number;
  sandwichCount: number;
  liquidationCount: number;
}

/**
 * Value extracted per MEV type over block buckets across [from, to] (X9). The
 * value series is ETH-denominated and, without a price feed at aggregation
 * time, sums only WETH-denominated profit (arbitrage/sandwich) and received
 * collateral (liquidation) — a consistent lower bound. Per-type counts are
 * returned alongside so the timeline can fall back to activity where ETH value
 * is sparse. `bucketSize` defaults to ~200 buckets across the range.
 */
export async function getMevValueSeries(
  from: number,
  to: number,
  bucketSize?: number,
): Promise<{ bucketSize: number; buckets: MevValueBucket[] }> {
  const size = bucketSize ?? Math.max(1, Math.ceil((to - from + 1) / 200));

  // one grouped aggregate per type: WETH-denominated wei sum + row count,
  // bucketed by block number (integer division onto the left edge).
  const agg = (table: string, amountCol: string, tokenCol: string) =>
    pool.query(
      `SELECT (block_number / $3)::bigint * $3 AS bucket,
              COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN lower(${tokenCol}) = $4
                                THEN ${amountCol} ELSE 0 END), 0) AS wei
       FROM ${table}
       WHERE block_number BETWEEN $1 AND $2
       GROUP BY bucket`,
      [from, to, size, WETH_ADDRESS],
    );

  // The bucket grid is seeded from the `blocks` table so a bucket only exists
  // when at least one of its blocks was actually inspected. Un-inspected spans
  // therefore produce NO bucket at all (a gap), rather than a bucket valued at
  // 0 — the timeline must not imply "we looked and found nothing" where we
  // never looked. An inspected bucket with no MEV legitimately stays at 0.
  const inspected = pool.query(
    `SELECT (block_number / $3)::bigint * $3 AS bucket, COUNT(*) AS n
     FROM blocks WHERE block_number BETWEEN $1 AND $2
     GROUP BY bucket`,
    [from, to, size],
  );

  const [blocksAgg, arbs, sandwiches, liquidations] = await Promise.all([
    inspected,
    agg("arbitrages", "profit_amount", "profit_token_address"),
    agg("sandwiches", "profit_amount", "profit_token_address"),
    agg("liquidations", "received_amount", "received_token_address"),
  ]);

  const byBucket = new Map<number, MevValueBucket>();
  for (const row of blocksAgg.rows) {
    const bucket = Number(row.bucket);
    byBucket.set(bucket, {
      bucket,
      inspectedBlocks: Number(row.n),
      arbitrageEth: 0,
      sandwichEth: 0,
      liquidationEth: 0,
      arbitrageCount: 0,
      sandwichCount: 0,
      liquidationCount: 0,
    });
  }
  // MEV only folds into inspected buckets (any block with a detected MEV row is
  // by definition inspected, so its bucket already exists; guard defensively).
  const fold = (
    rows: { bucket: unknown; n: unknown; wei: unknown }[],
    ethKey: "arbitrageEth" | "sandwichEth" | "liquidationEth",
    countKey: "arbitrageCount" | "sandwichCount" | "liquidationCount",
  ) => {
    for (const row of rows) {
      const b = byBucket.get(Number(row.bucket));
      if (!b) continue;
      b[ethKey] += Number(row.wei) / 1e18;
      b[countKey] += Number(row.n);
    }
  };
  fold(arbs.rows, "arbitrageEth", "arbitrageCount");
  fold(sandwiches.rows, "sandwichEth", "sandwichCount");
  fold(liquidations.rows, "liquidationEth", "liquidationCount");

  return {
    bucketSize: size,
    buckets: [...byBucket.values()].sort((a, b) => a.bucket - b.bucket),
  };
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

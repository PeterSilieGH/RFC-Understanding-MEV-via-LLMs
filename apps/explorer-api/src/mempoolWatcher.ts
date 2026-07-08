import { loadConfig } from "@mev/config";
import { ethers } from "ethers";

const config = loadConfig();

// eth_getFilterChanges is a cheap diff (just new hashes), so we can poll it
// tightly for good time resolution without much RPC/CPU cost. We deliberately
// avoid txpool_content here - it can dump ~20k+ queued transactions on every
// call, causing multi-hundred-MB memory churn for no benefit (we only ever
// need the much smaller "pending" set).
const FILTER_POLL_INTERVAL_MS = 100;
const RETENTION_MS = 2 * 60 * 1000; // discard sightings older than 2 minutes

const provider = new ethers.JsonRpcProvider(config.RPC_URL);

export type MempoolStatus = "public" | "private" | "unknown";

export interface MempoolClassification {
  status: MempoolStatus;
  secondsInMempool: number | null;
  firstSeenAtMs: number | null;
}

// txHash (lowercase) -> first-seen unix ms
const firstSeenAt = new Map<string, number>();
let watcherStartedAtMs: number | null = null;
let pollFailures = 0;
let filterId: string | null = null;

function recordHash(hash: string | null | undefined): void {
  const h = hash?.toLowerCase();
  if (h && !firstSeenAt.has(h)) firstSeenAt.set(h, Date.now());
}

async function ensureFilter(): Promise<string> {
  if (filterId) return filterId;
  filterId = (await provider.send("eth_newPendingTransactionFilter", [])) as string;
  return filterId;
}

async function pollFilter(): Promise<void> {
  try {
    await ensureFilter();
    const hashes = (await provider.send("eth_getFilterChanges", [filterId])) as string[] | null;
    for (const hash of hashes || []) recordHash(hash);
    pollFailures = 0;
  } catch {
    // filter likely expired/invalid (e.g. node restart) - recreate next tick
    filterId = null;
    pollFailures += 1;
  }
}

function evictOld(): void {
  const cutoff = Date.now() - RETENTION_MS;
  for (const [hash, seenAt] of firstSeenAt) {
    if (seenAt < cutoff) firstSeenAt.delete(hash);
  }
}

export function start(): void {
  if (watcherStartedAtMs !== null) return;
  watcherStartedAtMs = Date.now();
  pollFilter();
  setInterval(pollFilter, FILTER_POLL_INTERVAL_MS);
  setInterval(evictOld, 15000);
}

/**
 * Classify a transaction's mempool visibility for a block mined at blockTimestampMs.
 * - "public": we saw it pending before inclusion; includes secondsInMempool
 * - "private": block is within our tracked retention window and we were already
 *   watching before it was mined, yet we never saw it pending -> it skipped the
 *   public mempool (e.g. sent directly to a builder)
 * - "unknown": the block is too old (outside the 2-minute retention window) or
 *   predates the watcher starting, so we have no coverage either way
 */
export function classify(txHash: string, blockTimestampMs: number): MempoolClassification {
  const hash = txHash.toLowerCase();
  const seenAt = firstSeenAt.get(hash);

  if (seenAt !== undefined) {
    const rawDiffMs = blockTimestampMs - seenAt;
    // A negative diff means we recorded "first seen" after the block's own
    // timestamp - impossible, and a sign our poll loop fell behind (e.g.
    // event-loop contention) and only processed this hash in a later, delayed
    // batch. The true time-in-mempool was still short (it got mined almost
    // immediately) - we just can't pin down an exact number, so the caller
    // renders this as "<1s" rather than a falsely-precise "0s".
    const secondsInMempool = rawDiffMs >= 0 ? rawDiffMs / 1000 : null;
    return { status: "public", secondsInMempool, firstSeenAtMs: seenAt };
  }

  const now = Date.now();
  const withinRetention = now - blockTimestampMs <= RETENTION_MS;
  const watchedBeforeBlock = watcherStartedAtMs !== null && watcherStartedAtMs <= blockTimestampMs;

  if (withinRetention && watchedBeforeBlock) {
    return { status: "private", secondsInMempool: null, firstSeenAtMs: null };
  }
  return { status: "unknown", secondsInMempool: null, firstSeenAtMs: null };
}

export function getStatus(): {
  trackedHashes: number;
  watcherStartedAtMs: number | null;
  healthy: boolean;
} {
  return {
    trackedHashes: firstSeenAt.size,
    watcherStartedAtMs,
    healthy: pollFailures < 5,
  };
}

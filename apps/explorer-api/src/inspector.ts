import { loadConfig } from "@mev/config";
import { pool } from "@mev/db";
import { inspectBlock } from "@mev/inspect";
import { ethers } from "ethers";

// Block inspection is now in-process (ADR-010): the native @mev/inspect engine
// fetches the block's traces over RPC, decodes/classifies/pattern-matches, and
// writes the facts to Postgres — replacing the per-block `docker run
// mev-inspect-py` container. The old USD-summary "treat failure as success"
// workaround is gone with the Python step that caused it (audit B6): a failure
// here is a real failure.
const config = loadConfig();
const provider = new ethers.JsonRpcProvider(config.RPC_URL);

const inFlight = new Map<number, Promise<unknown>>();

export async function isInspected(blockNumber: number): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM blocks WHERE block_number = $1", [blockNumber]);
  return (result.rowCount ?? 0) > 0;
}

// A degraded RPC node can leave a block's fetch hanging indefinitely; bound it
// so a single bad block can't stall the whole backfill/head-follow loop.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`block inspection timed out after ${ms / 1000}s - RPC node degraded?`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export async function inspectBlockIfNeeded(
  blockNumber: number,
): Promise<{ alreadyInspected: boolean }> {
  if (await isInspected(blockNumber)) {
    return { alreadyInspected: true };
  }

  // In-memory dedupe: concurrent requests for the same block share one run.
  const existing = inFlight.get(blockNumber);
  if (existing) {
    await existing;
    return { alreadyInspected: true };
  }

  const promise = withTimeout(
    inspectBlock(provider, blockNumber),
    config.INSPECT_TIMEOUT_MS,
  ).finally(() => inFlight.delete(blockNumber));
  inFlight.set(blockNumber, promise);

  await promise;
  return { alreadyInspected: false };
}

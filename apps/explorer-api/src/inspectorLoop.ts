import { loadConfig } from "@mev/config";
import { ethers } from "ethers";
import { inspectBlockIfNeeded } from "./inspector.js";

// Optional head-follower (ADR-010): once started, continuously inspects new
// blocks as the chain advances, so the explorer stays current without a manual
// backfill. The on-demand `/api/block/:n` path and the backfill queue remain the
// primary drivers; this just keeps the head warm. Gated by INSPECTOR_FOLLOW_HEAD.
const config = loadConfig();
const provider = new ethers.JsonRpcProvider(config.RPC_URL);

const POLL_MS = 12_000; // ~one block time
const CONFIRMATIONS = 2; // stay a couple blocks behind head for reorg safety
const MAX_CATCHUP = 25; // bound per-tick catch-up so a cold start can't stampede the node

let started = false;
let lastInspected = 0;

export function startInspectorLoop(): void {
  if (started) return;
  started = true;
  console.log("inspector head-follower started");
  void tick();
}

async function tick(): Promise<void> {
  try {
    const head = await provider.getBlockNumber();
    const target = head - CONFIRMATIONS;
    const from = lastInspected === 0 ? target : Math.max(lastInspected + 1, target - MAX_CATCHUP);
    for (let n = from; n <= target; n++) {
      try {
        await inspectBlockIfNeeded(n);
      } catch (err) {
        console.error(`head-follow inspect ${n} failed:`, (err as Error).message);
      }
      lastInspected = Math.max(lastInspected, n);
    }
  } catch (err) {
    console.error("head-follow tick failed:", (err as Error).message);
  } finally {
    setTimeout(() => void tick(), POLL_MS);
  }
}

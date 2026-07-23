import { loadConfig } from "@mev/config";
import { migrate, pool } from "@mev/db";
import { getProvider } from "@mev/rpc";
import express from "express";
import {
  getAnalyzedRanges,
  getBackfillStatus,
  getFillStatus,
  getMevActivity,
  getMevValueSeries,
  startBackfill,
  startFillWorker,
  stopBackfill,
} from "./backfill.js";
import { getBlockBuilder, getBuilderStats } from "./builder.js";
import { getEurPrices } from "./eurPrices.js";
import { flagTx, listFlagged, unflagTx } from "./flagged.js";
import { getAddressActivity, getLeaderboard, getPoolHeatmap, getTopSearchers } from "./insights.js";
import { inspectBlockIfNeeded } from "./inspector.js";
import { startInspectorLoop } from "./inspectorLoop.js";
import { getMempoolStats } from "./mempoolStats.js";
import * as mempoolWatcher from "./mempoolWatcher.js";
import { getBlockMev } from "./mev.js";
import { getBuilderBid, getRelayStats } from "./relay.js";

const config = loadConfig();
const provider = getProvider();
const app = express();
app.use(express.json());

mempoolWatcher.start();

// Background inspection queue (wp-explorer-redesign E6). POST starts (or
// restarts) a walk from `fromBlock` up to the chain head; GET reports
// progress; DELETE stops the walk.
app.post("/api/backfill", async (req, res) => {
  const fromBlock = Number(req.body?.fromBlock);
  if (!Number.isInteger(fromBlock) || fromBlock < 0) {
    res.status(400).json({ error: "invalid fromBlock" });
    return;
  }
  try {
    const head = await provider.getBlockNumber();
    const targetBlock = Number.isInteger(Number(req.body?.toBlock))
      ? Math.min(Number(req.body.toBlock), head)
      : head;
    if (fromBlock > targetBlock) {
      res.status(400).json({ error: `fromBlock is beyond the chain head (${head})` });
      return;
    }
    res.json(await startBackfill(fromBlock, targetBlock));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/backfill", (_req, res) => {
  res.json(getBackfillStatus());
});

app.delete("/api/backfill", (_req, res) => {
  res.json(stopBackfill());
});

// ADR-017 §4: flagged incidents shared between DiscoUI and the Explorer.
const TX_HASH_RE = /^0x[0-9a-f]{64}$/;

app.get("/api/flagged", async (_req, res) => {
  try {
    res.json({ flagged: await listFlagged() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/flagged", async (req, res) => {
  const body = (req.body ?? {}) as {
    txHash?: unknown;
    project?: unknown;
    blockNumber?: unknown;
    label?: unknown;
    note?: unknown;
  };
  const txHash = typeof body.txHash === "string" ? body.txHash.toLowerCase() : "";
  if (!TX_HASH_RE.test(txHash)) {
    res.status(400).json({ error: "a valid txHash is required" });
    return;
  }
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const blockNumber = Number.isFinite(Number(body.blockNumber)) ? Number(body.blockNumber) : null;
  try {
    const flagged = await flagTx({
      txHash,
      project: str(body.project),
      blockNumber,
      label: str(body.label),
      note: str(body.note),
    });
    res.json({ flagged });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/flagged/:txHash", async (req, res) => {
  const txHash = req.params.txHash.toLowerCase();
  if (!TX_HASH_RE.test(txHash)) {
    res.status(400).json({ error: "a valid txHash is required" });
    return;
  }
  try {
    await unflagTx(txHash);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/analyzed-ranges", async (req, res) => {
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    res.status(400).json({ error: "invalid from/to" });
    return;
  }
  try {
    res.json({ from, to, ranges: await getAnalyzedRanges(from, to) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/mev-activity", async (req, res) => {
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    res.status(400).json({ error: "invalid from/to" });
    return;
  }
  try {
    res.json({ from, to, blocks: await getMevActivity(from, to) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Value extracted per MEV type over block buckets (X9, ADR-011 §2): drives the
// timeline's 3-series (arbitrage / sandwich / liquidation) value-over-time graph.
app.get("/api/mev-value", async (req, res) => {
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  const bucket = req.query.bucket === undefined ? undefined : Number(req.query.bucket);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    res.status(400).json({ error: "invalid from/to" });
    return;
  }
  if (bucket !== undefined && (!Number.isInteger(bucket) || bucket <= 0)) {
    res.status(400).json({ error: "invalid bucket" });
    return;
  }
  try {
    res.json({ from, to, ...(await getMevValueSeries(from, to, bucket)) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Continuous fixed-range fill worker status (X10).
app.get("/api/fill", (_req, res) => {
  res.json(getFillStatus());
});

app.get("/api/latest", async (_req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    res.json({ blockNumber });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/mempool-status", (_req, res) => {
  res.json(mempoolWatcher.getStatus());
});

// Aggregated public/private order-flow statistics over every persisted
// mempool classification (tx_mempool), per block plus an overall summary.
app.get("/api/mempool-stats", async (_req, res) => {
  try {
    res.json(await getMempoolStats());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/block/:number", async (req, res) => {
  const blockNumber = Number(req.params.number);
  if (!Number.isInteger(blockNumber) || blockNumber < 0) {
    res.status(400).json({ error: "invalid block number" });
    return;
  }

  try {
    const { alreadyInspected } = await inspectBlockIfNeeded(blockNumber);
    let transactions = await getBlockMev(blockNumber);
    if (!alreadyInspected && transactions.length === 0) {
      // freshly inspected blocks can briefly lag before the write is visible
      await new Promise((r) => setTimeout(r, 500));
      transactions = await getBlockMev(blockNumber);
    }
    const builder = await getBlockBuilder(blockNumber).catch(() => ({
      builder: null,
      feeRecipient: null,
      blockHash: null,
    }));
    const bid = await getBuilderBid(blockNumber, builder.blockHash).catch(() => null);
    res.json({ blockNumber, alreadyInspected, transactions, builder, bid });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Per-transaction MEV facts for the trace view (M4): the merged mev[] entry
// plus decoded swaps (with trace addresses) for one tx of an already
// inspected block. Read-only; never triggers inspection itself - the block
// endpoint above owns that.
app.get("/api/mev/tx/:txHash", async (req, res) => {
  const txHash = req.params.txHash.toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
    res.status(400).json({ error: "invalid transaction hash" });
    return;
  }

  try {
    const known = await pool.query(
      "SELECT block_number FROM miner_payments WHERE transaction_hash = $1 LIMIT 1",
      [txHash],
    );
    if (known.rows.length === 0) {
      // not inspected - resolve the block via RPC so the UI can point the
      // user at the explorer's block view (which does inspect on demand)
      const tx = await provider.getTransaction(txHash).catch(() => null);
      res.json({ inspected: false, blockNumber: tx?.blockNumber ?? null, transaction: null });
      return;
    }
    const blockNumber = Number(known.rows[0].block_number);
    const transactions = await getBlockMev(blockNumber);
    const transaction = transactions.find((t) => t.hash === txHash) ?? null;
    res.json({ inspected: true, blockNumber, transaction });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/address/:address", async (req, res) => {
  const address = req.params.address;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: "invalid address" });
    return;
  }
  try {
    const items = await getAddressActivity(address);
    res.json({ address, items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/leaderboard", async (_req, res) => {
  try {
    res.json(await getLeaderboard());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/pool-heatmap", async (_req, res) => {
  try {
    res.json({ pools: await getPoolHeatmap() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/builder-stats", async (_req, res) => {
  try {
    res.json({ builders: await getBuilderStats() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/relay-stats", async (_req, res) => {
  try {
    res.json({ relays: await getRelayStats() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/eur-prices", async (req, res) => {
  const tokens = String(req.query.tokens || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^0x[a-f0-9]{40}$/.test(t));

  if (tokens.length === 0) {
    res.json({ prices: {} });
    return;
  }

  try {
    res.json({ prices: await getEurPrices(tokens) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/top-searchers", async (_req, res) => {
  try {
    res.json({ searchers: await getTopSearchers() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Own the shared schema at boot (ADR-010): explorer-api is the pipeline's
// writer, so it brings up both the app-owned cache tables and the MEV pipeline
// tables the native inspector fills. Idempotent — a no-op once created. This
// replaces the retired `alembic upgrade head` step that used to run via the
// compose `tools` profile against mev-inspect-py.
migrate()
  .catch((err) => {
    console.error("schema migration failed:", err);
    process.exit(1);
  })
  .then(() => {
    app.listen(config.EXPLORER_API_PORT, () => {
      console.log(`explorer-api listening on http://localhost:${config.EXPLORER_API_PORT}`);
    });
    // Optionally keep the chain head continuously inspected (ADR-010).
    if (config.INSPECTOR_FOLLOW_HEAD) startInspectorLoop();
    // Optionally run the continuous fixed-range fill worker (ADR-011 §1, X10):
    // keeps [INSPECT_FLOOR_BLOCK … head] filled as the coverage corpus.
    if (config.INSPECTOR_FILL_RANGE) startFillWorker();
  });

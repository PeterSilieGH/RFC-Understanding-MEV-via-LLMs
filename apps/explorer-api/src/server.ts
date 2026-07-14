import { loadConfig } from "@mev/config";
import { pool } from "@mev/db";
import { ethers } from "ethers";
import express from "express";
import { getBlockBuilder, getBuilderStats } from "./builder.js";
import { getEurPrices } from "./eurPrices.js";
import { getAddressActivity, getLeaderboard, getPoolHeatmap, getTopSearchers } from "./insights.js";
import { inspectBlockIfNeeded } from "./inspector.js";
import { getMempoolStats } from "./mempoolStats.js";
import * as mempoolWatcher from "./mempoolWatcher.js";
import { getBlockMev } from "./mev.js";
import { getBuilderBid, getRelayStats } from "./relay.js";

const config = loadConfig();
const provider = new ethers.JsonRpcProvider(config.RPC_URL);
const app = express();

mempoolWatcher.start();

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

app.listen(config.EXPLORER_API_PORT, () => {
  console.log(`explorer-api listening on http://localhost:${config.EXPLORER_API_PORT}`);
});

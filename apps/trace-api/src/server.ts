import { loadConfig } from "@mev/config";
import { isTxHash, normalizeAddress, toTraceGraph } from "@mev/trace-graph";
import express from "express";
import { getContractSources } from "./etherscan.js";
import { getDebugTrace } from "./provider.js";

const config = loadConfig();
const app = express();

// Traces are immutable once mined - cache the parsed call tree in memory.
const traceCache = new Map<string, Awaited<ReturnType<typeof getDebugTrace>>>();
const TRACE_CACHE_MAX = 200;

async function getTraceCached(txHash: string) {
  const cached = traceCache.get(txHash);
  if (cached) return cached;
  const trace = await getDebugTrace(txHash);
  if (traceCache.size >= TRACE_CACHE_MAX) {
    const oldest = traceCache.keys().next().value;
    if (oldest) traceCache.delete(oldest);
  }
  traceCache.set(txHash, trace);
  return trace;
}

app.get("/health", (_req, res) => {
  res.send("OK");
});

app.get("/api/traces/:txHash/raw", async (req, res) => {
  const txHash = req.params.txHash.toLowerCase();
  if (!isTxHash(txHash)) {
    res.status(400).json({ error: "invalid transaction hash" });
    return;
  }
  try {
    res.json(await getTraceCached(txHash));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/traces/:txHash/graph", async (req, res) => {
  const txHash = req.params.txHash.toLowerCase();
  if (!isTxHash(txHash)) {
    res.status(400).json({ error: "invalid transaction hash" });
    return;
  }
  try {
    const trace = await getTraceCached(txHash);
    res.json(toTraceGraph(txHash, "eth", trace));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Accepts both plain 0x… and chain-specific eth:0x… addresses (ADR-004).
app.get("/api/contracts/:address/code", async (req, res) => {
  const address = normalizeAddress(req.params.address);
  if (!address) {
    res.status(400).json({ error: "invalid address" });
    return;
  }
  try {
    const contract = await getContractSources(address);
    if (!contract) {
      res.status(404).json({
        error: config.ETHERSCAN_API_KEY
          ? "no verified source found"
          : "ETHERSCAN_API_KEY not configured",
      });
      return;
    }
    res.json({ address, entryName: contract.name, sources: contract.sources });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/contracts/:address/meta", async (req, res) => {
  const address = normalizeAddress(req.params.address);
  if (!address) {
    res.status(400).json({ error: "invalid address" });
    return;
  }
  try {
    const contract = await getContractSources(address);
    if (!contract) {
      res.status(404).json({
        error: config.ETHERSCAN_API_KEY
          ? "no verified source found"
          : "ETHERSCAN_API_KEY not configured",
      });
      return;
    }
    const { sources, abi, ...meta } = contract;
    res.json({
      address,
      ...meta,
      abiEntryCount: abi?.length ?? 0,
      sourceFileCount: sources.length,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.listen(config.TRACE_API_PORT, () => {
  console.log(`trace-api listening on http://localhost:${config.TRACE_API_PORT}`);
});

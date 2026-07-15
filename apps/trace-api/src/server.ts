import { loadConfig } from "@mev/config";
import { isTxHash, normalizeAddress, toTraceGraph } from "@mev/trace-graph";
import express from "express";
import { getContractSources } from "./etherscan.js";
import { getTraceCached } from "./provider.js";
import { getWorkspaceStatus } from "./workspace.js";

const config = loadConfig();
const app = express();

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

// Resolve the tx's incident and report/kick off its synthetic discovery
// project (ADR-008). GET with a lazy side effect, like block inspection.
app.get("/api/traces/:txHash/workspace", async (req, res) => {
  const txHash = req.params.txHash.toLowerCase();
  if (!isTxHash(txHash)) {
    res.status(400).json({ error: "invalid transaction hash" });
    return;
  }
  try {
    res.json(await getWorkspaceStatus(txHash));
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

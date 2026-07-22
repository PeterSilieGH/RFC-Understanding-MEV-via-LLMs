import { loadConfig } from "@mev/config";
import { getProvider } from "@mev/rpc";
import { isTxHash, normalizeAddress } from "@mev/trace-graph";
import express from "express";
import { CandidateAnalysisGateway, CandidateNotFoundError } from "./candidateAnalysis.js";
import { getNormalizedSource, readCandidateCatalog } from "./contractEvidence.js";
import { DecompilationGateway, UnixDecompilerClient } from "./decompiler.js";
import { getContractSources } from "./etherscan.js";
import { discoveryRpc, evidenceStore } from "./evidence.js";
import { getDebugTrace } from "./provider.js";
import type { JsonRpcRequest } from "./rpcAdapter.js";
import { TraceEvidenceGateway } from "./traceEvidence.js";
import { getWorkspaceStatus } from "./workspace.js";

const config = loadConfig();
const app = express();
app.use(express.json());

const traceEvidence = new TraceEvidenceGateway(evidenceStore, getProvider());
const decompilation = new DecompilationGateway(
  evidenceStore,
  new UnixDecompilerClient(config.DECOMPILER_API_SOCKET, config.DECOMPILER_REQUEST_TIMEOUT_MS),
);
const candidateAnalysis = new CandidateAnalysisGateway({
  readCatalog: readCandidateCatalog,
  readSource: getNormalizedSource,
  resolveDecompilation: (runtimeCodehash) => decompilation.resolve(runtimeCodehash),
  store: evidenceStore,
});

app.get("/health", (_req, res) => {
  res.send("OK");
});

// Internal host-only JSON-RPC endpoint for l2b discovery. It is not exposed by
// disco-web nginx. Batches are accepted because ethers may coalesce requests.
app.post("/internal/discovery-rpc", async (req, res) => {
  const requests = Array.isArray(req.body) ? req.body : [req.body];
  const responses = await Promise.all(
    requests.map((request) => discoveryRpc.handle(request as JsonRpcRequest)),
  );
  res.json(Array.isArray(req.body) ? responses : responses[0]);
});

app.get("/internal/evidence/projects/:project/catalog", async (req, res) => {
  try {
    res.json(await readCandidateCatalog(req.params.project));
  } catch (error) {
    res.status(409).json({ error: (error as Error).message });
  }
});

// Deliberately POST: unlike the catalog lookup, this endpoint may perform one
// lazy, cached decompilation for an allowlisted project candidate.
app.post(
  "/internal/evidence/projects/:project/candidates/:candidateId/analysis",
  async (req, res) => {
    try {
      res.json(await candidateAnalysis.resolve(req.params.project, req.params.candidateId));
    } catch (error) {
      if (error instanceof CandidateNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(502).json({ error: (error as Error).message });
    }
  },
);

app.get("/api/traces/:txHash/raw", async (req, res) => {
  const txHash = req.params.txHash.toLowerCase();
  if (!isTxHash(txHash)) {
    res.status(400).json({ error: "invalid transaction hash" });
    return;
  }
  try {
    // Raw detail is the explicit opt-in replay route. Normal graph/Funds reads
    // use persisted normalized evidence and do not arrive here.
    res.json(await getDebugTrace(txHash));
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
    const envelope = await traceEvidence.getGraph(txHash);
    // Backward-compatible payload for existing clients. New clients use v2.
    res.json(envelope.graph);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/traces/:txHash/graph/v2", async (req, res) => {
  const txHash = req.params.txHash.toLowerCase();
  if (!isTxHash(txHash)) {
    res.status(400).json({ error: "invalid transaction hash" });
    return;
  }
  try {
    res.json(await traceEvidence.getGraph(txHash));
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

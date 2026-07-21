// One shared JsonRpcProvider per process (ADR-011 §3, TODO explorer item 10).
//
// The inspection subsystem had grown one `ethers.JsonRpcProvider` per module
// (inspector, inspectorLoop, mempoolWatcher, builder, tokens, server, ...),
// each with its own request-batch queue and keep-alive connections against a
// single upstream node that enforces a server-side connection cap. That is not
// sharding across endpoints — it is uncoordinated fan-out against one endpoint,
// and it is the recurring cause of "Too many connections" degradation
// (see docs memory rpc-node-connection-cap).
//
// Every module now shares the one provider this module memoizes. ethers batches
// JSON-RPC requests that arrive within its stall window into single HTTP
// round-trips, so folding all callers onto one provider lets that batching span
// the whole process and reuses one connection pool instead of N.
import { loadConfig } from "@mev/config";
import { ethers } from "ethers";

let provider: ethers.JsonRpcProvider | null = null;

/**
 * The process-wide shared provider. Lazily constructed on first use so importing
 * this module has no side effects (config is read, and the connection opened, on
 * demand). Construction is intentionally identical to the per-module providers
 * it replaces — the connection win comes from there being exactly one.
 */
export function getProvider(): ethers.JsonRpcProvider {
  if (provider === null) {
    const config = loadConfig();
    provider = new ethers.JsonRpcProvider(config.RPC_URL);
  }
  return provider;
}

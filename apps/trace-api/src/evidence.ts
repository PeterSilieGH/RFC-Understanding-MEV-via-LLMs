import { loadConfig } from "@mev/config";
import { PostgresEvidenceStore } from "@mev/evidence";
import { createHttpUpstream, DiscoveryRpcAdapter } from "./rpcAdapter.js";

const config = loadConfig();

export const evidenceStore = new PostgresEvidenceStore();

/** Shared by the HTTP adapter and controlled discovery import. */
export const discoveryRpc = new DiscoveryRpcAdapter(createHttpUpstream(config.RPC_URL), {
  maxLogBlocks: config.RPC_GETLOGS_MAX_BLOCKS,
  logPageSize: config.RPC_GETLOGS_PAGE_SIZE,
});

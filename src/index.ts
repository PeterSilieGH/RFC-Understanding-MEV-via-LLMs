// MEV Research Framework — Public API

// Ethereum data layer
export { EthClient, CHAINS, type ChainConfig, type SubscribeOptions, type BlockData, type TxData, type TraceResult } from "./eth/client.js";
export { PriceOracle, KNOWN_TOKENS, type PriceData } from "./eth/oracle.js";

// Analysis
export { ProfitabilityEngine } from "./analysis/profitability.js";
export {
  type MEVType,
  type MEVEvent,
  type PendingTx,
  type BundleContext,
  type BundleTx,
  type DexSwap,
  type LiquidationCall,
  type AnalysisResult,
  type AnalysisSummary,
  type SimulationResult,
  type MEVSearchFilter,
  MEV_TYPE_LABELS,
} from "./analysis/types.js";

// Utilities
export { logger } from "./utils/logger.js";
export { startTunnel, startNamedTunnel, stopTunnel, startTunnelWithHealthCheck, type TunnelConfig, type Tunnel } from "./utils/tunnel.js";
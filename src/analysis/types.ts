// ─── MEV Types ────────────────────────────────────────────────────────────────

/** Categories of MEV */
export type MEVType =
  | "arbitrage"
  | "sandwich"
  | "liquidation"
  | "jit"
  | "frontrun"
  | "backrun"
  | "multihop"
  | "unknown";

export const MEV_TYPE_LABELS: Record<MEVType, string> = {
  arbitrage:   "DEX Arbitrage",
  sandwich:     "Sandwich Attack",
  liquidation:  "Liquidation",
  jit:          "Just-in-Time Liquidity",
  frontrun:     "Frontrun",
  backrun:      "Backrun",
  multihop:     "Multi-hop",
  unknown:      "Unknown",
};

/** A detected MEV opportunity or extraction */
export interface MEVEvent {
  id: string;
  type: MEVType;
  chainId: number;
  blockNumber: number;
  txHashes: string[];         // all txs involved (attacker + victim(s))
  attacker: string;            // EOA or contract that extracted MEV
  victims?: string[];         // addresses harmed (sandwich, liquidations)
  profitWei: bigint;          // extracted profit in native token wei
  profitUsd?: number;         // USD equivalent at time of event
  gasUsed: bigint;
  gasPrice: bigint;
  bundle?: BundleContext;     // context of bundle transactions
  raw?: unknown;              // raw detection data for debugging
  confidence: "high" | "medium" | "low";
  detectedAt: number;         // unix timestamp ms
}

/** Context for a multi-tx MEV bundle */
export interface BundleContext {
  txs: BundleTx[];
  totalGas: bigint;
  totalProfitWei: bigint;
  /** Whether this bundle was submitted via Flashbots or similar privacy layer */
  viaFlashbots?: boolean;
}

export interface BundleTx {
  hash?: string;
  from: string;
  to: string | null;
  data: string;
  value: bigint;
  gasPrice: bigint;
  position: "frontrun" | "middle" | "backrun" | "single";
}

/** A pending transaction in the mempool */
export interface PendingTx {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  data: string;
  nonce: number;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  chainId: number;
  /** Parsed if it's a DEX swap */
  dexSwap?: DexSwap;
  /** Parsed if it's a liquidation call */
  liquidation?: LiquidationCall;
  /** Estimated USD value */
  valueUsd?: number;
  /** Whether this tx looks exploitable */
  exploitable: boolean;
  exploitationType?: MEVType;
  exploitationNotes?: string;
}

export interface DexSwap {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutMin: bigint;
  /** DEX name if recognized */
  dex?: string;
  /** Route if multi-hop */
  route?: string[];
}

export interface LiquidationCall {
  protocol: string;
  collateralToken: string;
  debtToken: string;
  borrower: string;
  debtToCover: bigint;
  /** Health factor before tx — if < 1.0 it's liquidatable */
  healthFactor?: number;
}

// ─── Analysis results ─────────────────────────────────────────────────────────

export interface AnalysisResult {
  blockNumber: number;
  mevEvents: MEVEvent[];
  summary: AnalysisSummary;
}

export interface AnalysisSummary {
  totalMEVProfit: bigint;
  totalMEVProfitUsd?: number;
  eventCount: number;
  byType: Partial<Record<MEVType, { count: number; profit: bigint }>>;
  topAttackers: { address: string; profit: bigint; eventCount: number }[];
}

// ─── Simulation ───────────────────────────────────────────────────────────────

export interface SimulationResult {
  success: boolean;
  gasUsed?: bigint;
  revertReason?: string;
  logs?: unknown[];
  /** Simulated profit in native token */
  profit?: bigint;
  /** Calls made during execution */
  calls?: TraceCall[];
}

export interface TraceCall {
  from: string;
  to: string;
  value: bigint;
  input: string;
  output: string;
  calls?: TraceCall[];
}

// ─── Search filters ───────────────────────────────────────────────────────────

export interface MEVSearchFilter {
  chainId?: number;
  blockStart?: number;
  blockEnd?: number;
  type?: MEVType | MEVType[];
  attacker?: string;
  minProfitWei?: bigint;
  maxResults?: number;
  timeframe?: "1h" | "6h" | "24h" | "7d" | "all";
}
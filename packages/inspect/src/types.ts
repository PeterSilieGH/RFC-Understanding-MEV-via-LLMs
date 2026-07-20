// Ported from mev-inspect-py `mev_inspect/schemas/` (traces.py, blocks.py,
// receipts.py, transfers.py, swaps.py, liquidations.py, nft_trades.py,
// miner_payments.py, arbitrages.py, sandwiches.py, classifiers.py).
//
// Wei amounts are `bigint` (repo convention). Addresses are stored lowercased
// throughout — matching mev-inspect-py, which lower-cases both trace addresses
// (they arrive lower-cased from `trace_block`) and ABI-decoded address inputs.

// ---------------------------------------------------------------------------
// Enumerations (string-literal unions + const maps; `Protocol` is left open so
// new protocols can be added with just a spec file — ADR-010).
// ---------------------------------------------------------------------------

export type TraceType = "call" | "create" | "delegateCall" | "reward" | "suicide";

export type Classification = "unknown" | "swap" | "transfer" | "liquidate" | "seize" | "nft_trade";

/**
 * Protocol tag. The canonical form is the mev-inspect-py enum *name*
 * (e.g. "uniswap_v2", "zero_ex"); {@link protocolWireValue} maps it to the
 * value written to `swaps`/`arbitrages` ("uniswap_v2", "0x"), and
 * {@link protocolTraceRepr} to the `classified_traces` repr ("Protocol.…").
 */
export type Protocol = string;

export const Protocol = {
  uniswap_v2: "uniswap_v2",
  uniswap_v3: "uniswap_v3",
  uniswap_v4: "uniswap_v4",
  sushiswap: "sushiswap",
  aave: "aave",
  aave_v3: "aave_v3",
  weth: "weth",
  curve: "curve",
  zero_ex: "zero_ex",
  balancer_v1: "balancer_v1",
  balancer_v2: "balancer_v2",
  compound_v2: "compound_v2",
  compound_v3: "compound_v3",
  cream: "cream",
  bancor: "bancor",
  opensea: "opensea",
} as const;

/** Irregular enum values (name → wire value). Everything else is identity. */
const PROTOCOL_WIRE_VALUES: Record<string, string> = { zero_ex: "0x" };

/** Value written to `swaps.protocol` / `arbitrages.protocols[]` (enum `.value`). */
export function protocolWireValue(protocol: Protocol | null | undefined): string | null {
  if (protocol == null) return null;
  return PROTOCOL_WIRE_VALUES[protocol] ?? protocol;
}

/** Value written to `classified_traces.protocol` — Python `str(enum)`, incl. the literal "None". */
export function protocolTraceRepr(protocol: Protocol | null | undefined): string {
  return protocol == null ? "None" : `Protocol.${protocol}`;
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

/** Raw Parity-style trace as returned by `trace_block` (camelCase JSON). */
export interface RawTrace {
  action: Record<string, unknown>;
  blockHash: string;
  blockNumber: number;
  result: Record<string, unknown> | null;
  subtraces: number;
  traceAddress: number[];
  transactionHash: string | null;
  transactionPosition: number | null;
  type: TraceType;
  error?: string | null;
}

/**
 * A classified trace. Flattens mev-inspect-py's Trace → ClassifiedTrace →
 * CallTrace → DecodedCallTrace hierarchy into one shape; use {@link isDecodedCall}
 * to narrow to a decoded call (abiName / functionSignature / inputs present).
 */
export interface ClassifiedTrace {
  action: Record<string, unknown>;
  blockNumber: number;
  transactionHash: string;
  transactionPosition: number;
  traceAddress: number[];
  subtraces: number;
  type: TraceType;
  error: string | null;
  classification: Classification;
  // call fields (null for non-call traces, e.g. create/suicide)
  toAddress: string | null;
  fromAddress: string | null;
  value: bigint | null;
  gas: bigint | null;
  gasUsed: bigint | null;
  // decoded fields (non-null only for a DecodedCallTrace)
  protocol: Protocol | null;
  abiName: string | null;
  functionName: string | null;
  functionSignature: string | null;
  inputs: Record<string, unknown> | null;
}

/** A decoded call trace: `abiName`, `functionSignature`, and `inputs` are present. */
export interface DecodedCallTrace extends ClassifiedTrace {
  toAddress: string;
  fromAddress: string;
  abiName: string;
  functionName: string;
  functionSignature: string;
  inputs: Record<string, unknown>;
}

export function isDecodedCall(trace: ClassifiedTrace): trace is DecodedCallTrace {
  return (
    trace.abiName !== null &&
    trace.functionSignature !== null &&
    trace.inputs !== null &&
    trace.toAddress !== null &&
    trace.fromAddress !== null
  );
}

// ---------------------------------------------------------------------------
// Block inputs
// ---------------------------------------------------------------------------

export interface Receipt {
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  cumulativeGasUsed: bigint;
  to: string | null;
}

export interface Block {
  blockNumber: number;
  blockTimestamp: number;
  miner: string;
  baseFeePerGas: bigint;
  traces: RawTrace[];
  receipts: Receipt[];
}

// ---------------------------------------------------------------------------
// Decoded / pattern-matched facts
// ---------------------------------------------------------------------------

export interface Transfer {
  blockNumber: number;
  transactionHash: string;
  traceAddress: number[];
  fromAddress: string;
  toAddress: string;
  amount: bigint;
  tokenAddress: string;
}

export interface Swap {
  abiName: string;
  transactionHash: string;
  transactionPosition: number;
  blockNumber: number;
  traceAddress: number[];
  contractAddress: string;
  fromAddress: string;
  toAddress: string;
  tokenInAddress: string;
  tokenInAmount: bigint;
  tokenOutAddress: string;
  tokenOutAmount: bigint;
  protocol: Protocol;
  error: string | null;
}

export interface Liquidation {
  liquidatedUser: string;
  liquidatorUser: string;
  debtTokenAddress: string;
  debtPurchaseAmount: bigint;
  receivedAmount: bigint;
  receivedTokenAddress: string | null;
  protocol: Protocol;
  transactionHash: string;
  traceAddress: number[];
  blockNumber: number;
  error: string | null;
}

export interface NftTrade {
  abiName: string;
  transactionHash: string;
  transactionPosition: number;
  blockNumber: number;
  traceAddress: number[];
  protocol: Protocol | null;
  error: string | null;
  sellerAddress: string;
  buyerAddress: string;
  paymentTokenAddress: string;
  paymentAmount: bigint;
  collectionAddress: string;
  tokenId: bigint;
}

export interface MinerPayment {
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  minerAddress: string;
  coinbaseTransfer: bigint;
  baseFeePerGas: bigint;
  gasPrice: bigint;
  gasPriceWithCoinbaseTransfer: bigint;
  gasUsed: bigint;
  transactionToAddress: string | null;
  transactionFromAddress: string | null;
}

export interface Arbitrage {
  swaps: Swap[];
  blockNumber: number;
  transactionHash: string;
  accountAddress: string;
  profitTokenAddress: string;
  startAmount: bigint;
  endAmount: bigint;
  profitAmount: bigint;
  error: string | null;
}

export interface Sandwich {
  blockNumber: number;
  sandwicherAddress: string;
  frontrunSwap: Swap;
  backrunSwap: Swap;
  sandwichedSwaps: Swap[];
  profitTokenAddress: string;
  profitAmount: bigint;
}

// ---------------------------------------------------------------------------
// Custom detector events (ADR-010: moved in-pipeline from explorer-api).
// ---------------------------------------------------------------------------

export interface JitLiquidityEvent {
  blockNumber: number;
  sender: string;
  mintTxHash: string;
  decreaseTxHash: string;
  token0: string;
  token1: string;
  fee: bigint | null;
  swapsBetween: number;
  matchingPoolSwaps: number;
}

export interface NonAtomicArbitrageEvent {
  blockNumber: number;
  address: string;
  firstTxHash: string;
  secondTxHash: string;
  tokenAddress: string;
  profitAmount: bigint;
}

export interface LiquidationSandwichEvent {
  blockNumber: number;
  liquidator: string;
  liquidationTxHash: string;
  setupSwapTxHash: string;
  reverseSwapTxHash: string | null;
}

export interface LiquidationRaceEvent {
  blockNumber: number;
  borrower: string;
  winnerTxHash: string;
  winnerAddress: string;
  loserTxHashes: string[];
}

export interface NftFlipEvent {
  blockNumber: number;
  flipper: string;
  collectionAddress: string;
  tokenId: bigint;
  buyTxHash: string;
  sellTxHash: string;
  profitAmount: bigint;
  profitTokenAddress: string;
}

// ---------------------------------------------------------------------------
// Classification specs (ports schemas/classifiers.py)
// ---------------------------------------------------------------------------

export interface CallData {
  functionName: string;
  functionSignature: string;
  inputs: Record<string, unknown>;
}

export interface TransferClassifier {
  classification: "transfer";
  getTransfer(trace: DecodedCallTrace): Transfer;
}

export interface SwapClassifier {
  classification: "swap";
  parseSwap(
    trace: DecodedCallTrace,
    priorTransfers: Transfer[],
    childTransfers: Transfer[],
  ): Swap | null;
}

export interface LiquidationClassifier {
  classification: "liquidate";
  parseLiquidation(
    trace: DecodedCallTrace,
    childTransfers: Transfer[],
    childTraces: ClassifiedTrace[],
  ): Liquidation | null;
}

export interface SeizeClassifier {
  classification: "seize";
}

export interface NftTradeClassifier {
  classification: "nft_trade";
  parseTrade(trace: DecodedCallTrace, childTransfers: Transfer[]): NftTrade | null;
}

export type Classifier =
  | TransferClassifier
  | SwapClassifier
  | LiquidationClassifier
  | SeizeClassifier
  | NftTradeClassifier;

export interface ClassifierSpec {
  abiName: string;
  protocol?: Protocol | null;
  validContractAddresses?: string[];
  classifiers?: Record<string, Classifier>;
  /**
   * Inline ABI (human-readable or JSON fragments). When set, the decoder uses
   * this instead of loading `abis/<protocol>/<abiName>.json` — lets a modern
   * protocol be added with just a spec file (ADR-010, Phase 2b). ethers accepts
   * human-readable signature strings, e.g. "function swap(...) returns (...)".
   */
  // biome-ignore lint/suspicious/noExplicitAny: ethers accepts a raw/human-readable ABI
  abi?: any[];
}

// Well-known token addresses (ports schemas/prices.py, lowercased).
export const ETH_TOKEN_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const WETH_TOKEN_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

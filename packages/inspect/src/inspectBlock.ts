// Ports mev_inspect/inspect_block.py's per-block flow: fetch → classify →
// extract facts → persist. The USD-summary step is intentionally dropped
// (audit B6): the explorer computes its own USD/EUR figures, and that step was
// the source of the "treat failure as success" workaround.
import type { JsonRpcProvider } from "ethers";
import { getArbitrages } from "./arbitrages.js";
import { TraceClassifier } from "./classify.js";
import { type DetectorResults, runDetectors } from "./detectors/index.js";
import { getLiquidations } from "./liquidations.js";
import { getMinerPayments } from "./minerPayments.js";
import { getNftTrades } from "./nftTrades.js";
import { fetchBlock } from "./rpc.js";
import { getSandwiches } from "./sandwiches.js";
import { getSwaps } from "./swaps.js";
import { getTransfers } from "./transfers.js";
import type {
  Arbitrage,
  Block,
  ClassifiedTrace,
  Liquidation,
  MinerPayment,
  NftTrade,
  Sandwich,
  Swap,
  Transfer,
} from "./types.js";
import { writeBlock } from "./writeBlock.js";

export interface InspectResult {
  blockNumber: number;
  blockTimestamp: number;
  classifiedTraces: ClassifiedTrace[];
  transfers: Transfer[];
  swaps: Swap[];
  arbitrages: Arbitrage[];
  liquidations: Liquidation[];
  sandwiches: Sandwich[];
  nftTrades: NftTrade[];
  minerPayments: MinerPayment[];
  detectors: DetectorResults;
}

// The classifier builds an ABI decoder per registered spec; build it once.
let sharedClassifier: TraceClassifier | null = null;
function classifier(): TraceClassifier {
  if (sharedClassifier === null) sharedClassifier = new TraceClassifier();
  return sharedClassifier;
}

/** Pure: derive all MEV facts for an already-fetched block (no I/O). */
export function inspectBlockFacts(block: Block): InspectResult {
  const classifiedTraces = classifier().classify(block.traces);
  const transfers = getTransfers(classifiedTraces);
  const swaps = getSwaps(classifiedTraces);
  const arbitrages = getArbitrages(swaps);
  const liquidations = getLiquidations(classifiedTraces);
  const sandwiches = getSandwiches(swaps);
  const nftTrades = getNftTrades(classifiedTraces);
  const minerPayments = getMinerPayments(
    block.miner,
    block.baseFeePerGas,
    classifiedTraces,
    block.receipts,
  );

  const detectors = runDetectors({
    blockNumber: block.blockNumber,
    classifiedTraces,
    swaps,
    liquidations,
    nftTrades,
    minerPayments,
  });

  return {
    blockNumber: block.blockNumber,
    blockTimestamp: block.blockTimestamp,
    classifiedTraces,
    transfers,
    swaps,
    arbitrages,
    liquidations,
    sandwiches,
    nftTrades,
    minerPayments,
    detectors,
  };
}

/** Fetch, inspect, and persist one block. */
export async function inspectBlock(
  provider: JsonRpcProvider,
  blockNumber: number,
): Promise<InspectResult> {
  const block = await fetchBlock(provider, blockNumber);
  const result = inspectBlockFacts(block);
  await writeBlock(result);
  return result;
}

// Runs the five custom detectors over a block's in-memory facts (ADR-010).
// These cover MEV patterns the core mev-inspect-py pipeline misses; they read
// the facts, never re-query, and their results are persisted to the mev_* tables.
import type {
  ClassifiedTrace,
  JitLiquidityEvent,
  Liquidation,
  LiquidationRaceEvent,
  LiquidationSandwichEvent,
  MinerPayment,
  NftFlipEvent,
  NftTrade,
  NonAtomicArbitrageEvent,
  Swap,
} from "../types.js";
import { detectJitLiquidity } from "./jitLiquidity.js";
import { detectLiquidationRaces } from "./liquidationRace.js";
import { detectLiquidationSandwiches } from "./liquidationSandwich.js";
import { detectNftFlips } from "./nftFlip.js";
import { detectNonAtomicArbitrage } from "./nonAtomicArbitrage.js";

export interface DetectorResults {
  jitLiquidity: JitLiquidityEvent[];
  nonAtomicArbitrages: NonAtomicArbitrageEvent[];
  liquidationSandwiches: LiquidationSandwichEvent[];
  liquidationRaces: LiquidationRaceEvent[];
  nftFlips: NftFlipEvent[];
}

export interface DetectorInput {
  blockNumber: number;
  classifiedTraces: ClassifiedTrace[];
  swaps: Swap[];
  liquidations: Liquidation[];
  nftTrades: NftTrade[];
  minerPayments: MinerPayment[];
}

export function runDetectors(input: DetectorInput): DetectorResults {
  const { blockNumber, classifiedTraces, swaps, liquidations, nftTrades, minerPayments } = input;
  return {
    jitLiquidity: detectJitLiquidity(blockNumber, classifiedTraces, swaps, minerPayments),
    nonAtomicArbitrages: detectNonAtomicArbitrage(blockNumber, swaps),
    liquidationSandwiches: detectLiquidationSandwiches(
      blockNumber,
      liquidations,
      swaps,
      minerPayments,
    ),
    liquidationRaces: detectLiquidationRaces(blockNumber, classifiedTraces),
    nftFlips: detectNftFlips(blockNumber, nftTrades),
  };
}

export {
  detectJitLiquidity,
  detectLiquidationRaces,
  detectLiquidationSandwiches,
  detectNftFlips,
  detectNonAtomicArbitrage,
};

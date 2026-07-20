// Ports mev_inspect/arbitrages.py. An arbitrage is a series of swaps that
// returns the initial token to the initial sender. Two documented bug fixes
// from the audit (docs/design/mev-inspect-audit.md) are applied inline:
//   B1 — equalWithinPercent no longer divides by zero on empty legs.
//   B2 — a route's closing swap must also not land in a pool address (the Python
//        docstring required this but the code only checked the opening swap).
import { compareTraceAddress } from "./traces.js";
import type { Arbitrage, Swap } from "./types.js";

const MAX_TOKEN_AMOUNT_PERCENT_DIFFERENCE = 0.01;

/** |(a-b) / (0.5*(a+b))| < threshold, guarding the zero denominator (B1). */
export function equalWithinPercent(a: bigint, b: bigint, threshold: number): boolean {
  if (a === b) return true; // exact match, including 0 == 0
  const sum = a + b;
  if (sum === 0n) return false; // opposite legs sum to zero → not equal (no divide-by-zero)
  const difference = Math.abs(Number(a - b) / (0.5 * Number(sum)));
  return difference < threshold;
}

export function getArbitrages(swaps: Swap[]): Arbitrage[] {
  const byTransaction = new Map<string, Swap[]>();
  for (const swap of swaps) {
    const existing = byTransaction.get(swap.transactionHash);
    if (existing) existing.push(swap);
    else byTransaction.set(swap.transactionHash, [swap]);
  }

  const allArbitrages: Arbitrage[] = [];
  for (const transactionSwaps of byTransaction.values()) {
    allArbitrages.push(...getArbitragesFromSwaps(transactionSwaps));
  }
  return allArbitrages;
}

function getArbitragesFromSwaps(swaps: Swap[]): Arbitrage[] {
  const allArbitrages: Arbitrage[] = [];
  const startEnds = getAllStartEndSwaps(swaps);
  if (startEnds.length === 0) return [];

  const usedSwaps: Swap[] = [];

  for (const [start, ends] of startEnds) {
    if (usedSwaps.includes(start)) continue;

    const unusedEnds = ends.filter((end) => !usedSwaps.includes(end));
    const route = getShortestRoute(start, unusedEnds, swaps);

    if (route !== null) {
      const startAmount = route[0].tokenInAmount;
      const endAmount = route[route.length - 1].tokenOutAmount;
      const profitAmount = endAmount - startAmount;
      let error: string | null = null;
      for (const swap of route) {
        if (swap.error !== null) error = swap.error;
      }

      allArbitrages.push({
        swaps: route,
        blockNumber: route[0].blockNumber,
        transactionHash: route[0].transactionHash,
        accountAddress: route[0].fromAddress,
        profitTokenAddress: route[0].tokenInAddress,
        startAmount,
        endAmount,
        profitAmount,
        error,
      });
      usedSwaps.push(...route);
    }
  }

  if (allArbitrages.length === 1) return allArbitrages;
  // Multiple candidate routes: keep only those that happen in a valid order.
  return allArbitrages.filter(
    (arb) =>
      compareTraceAddress(arb.swaps[0].traceAddress, arb.swaps[arb.swaps.length - 1].traceAddress) <
      0,
  );
}

function getShortestRoute(
  startSwap: Swap,
  endSwaps: Swap[],
  allSwaps: Swap[],
  maxRouteLength?: number,
): Swap[] | null {
  if (endSwaps.length === 0) return null;
  if (maxRouteLength !== undefined && maxRouteLength < 2) return null;

  for (const endSwap of endSwaps) {
    if (swapOutsMatchSwapIns(startSwap, endSwap)) return [startSwap, endSwap];
  }

  if (maxRouteLength !== undefined && maxRouteLength === 2) return null;

  const otherSwaps = allSwaps.filter((swap) => swap !== startSwap && !endSwaps.includes(swap));
  if (otherSwaps.length === 0) return null;

  let shortestRemainingRoute: Swap[] | null = null;
  let maxRemainingRouteLength = maxRouteLength === undefined ? undefined : maxRouteLength - 1;

  for (const nextSwap of otherSwaps) {
    if (swapOutsMatchSwapIns(startSwap, nextSwap)) {
      const shortestFromNext = getShortestRoute(
        nextSwap,
        endSwaps,
        otherSwaps,
        maxRemainingRouteLength,
      );
      if (
        shortestFromNext !== null &&
        (shortestRemainingRoute === null || shortestFromNext.length < shortestRemainingRoute.length)
      ) {
        shortestRemainingRoute = shortestFromNext;
        maxRemainingRouteLength = shortestFromNext.length - 1;
      }
    }
  }

  return shortestRemainingRoute === null ? null : [startSwap, ...shortestRemainingRoute];
}

function getAllStartEndSwaps(swaps: Swap[]): Array<[Swap, Swap[]]> {
  const poolAddrs = swaps.map((swap) => swap.contractAddress);
  const validStartEnds: Array<[Swap, Swap[]]> = [];

  for (let index = 0; index < swaps.length; index++) {
    const potentialStartSwap = swaps[index];
    const endsForStart: Swap[] = [];
    const remainingSwaps = [...swaps.slice(0, index), ...swaps.slice(index + 1)];

    for (const potentialEndSwap of remainingSwaps) {
      if (
        potentialStartSwap.tokenInAddress === potentialEndSwap.tokenOutAddress &&
        potentialStartSwap.contractAddress !== potentialEndSwap.contractAddress &&
        potentialStartSwap.fromAddress === potentialEndSwap.toAddress &&
        !poolAddrs.includes(potentialStartSwap.fromAddress) &&
        // B2: the closing swap must also not terminate into a pool address
        !poolAddrs.includes(potentialEndSwap.toAddress)
      ) {
        endsForStart.push(potentialEndSwap);
      }
    }

    if (endsForStart.length > 0) validStartEnds.push([potentialStartSwap, endsForStart]);
  }

  return validStartEnds;
}

function swapOutsMatchSwapIns(swapOut: Swap, swapIn: Swap): boolean {
  return (
    swapOut.tokenOutAddress === swapIn.tokenInAddress &&
    (swapOut.contractAddress === swapIn.fromAddress ||
      swapOut.toAddress === swapIn.contractAddress ||
      swapOut.toAddress === swapIn.fromAddress) &&
    equalWithinPercent(
      swapOut.tokenOutAmount,
      swapIn.tokenInAmount,
      MAX_TOKEN_AMOUNT_PERCENT_DIFFERENCE,
    )
  );
}

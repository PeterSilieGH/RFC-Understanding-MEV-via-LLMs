import { compareTraceAddress } from "../traces.js";
// Moved in-pipeline from apps/explorer-api/src/detectors/nonAtomicArbitrage.ts
// (ADR-010). Same address round-trips a token pair across two txs in one block.
// Materwala et al. 2024 (arXiv:2411.03327) flag non-atomic arbitrage as rarely
// addressed. Operates on the block's in-memory swaps (no re-query).
import type { NonAtomicArbitrageEvent, Swap } from "../types.js";

export function detectNonAtomicArbitrage(
  blockNumber: number,
  swaps: Swap[],
): NonAtomicArbitrageEvent[] {
  const ordered = [...swaps].sort(
    (a, b) =>
      a.transactionPosition - b.transactionPosition ||
      compareTraceAddress(a.traceAddress, b.traceAddress),
  );

  const byAddress = new Map<string, Swap[]>();
  for (const s of ordered) {
    const list = byAddress.get(s.fromAddress);
    if (list) list.push(s);
    else byAddress.set(s.fromAddress, [s]);
  }

  const results: NonAtomicArbitrageEvent[] = [];
  for (const [address, addressSwaps] of byAddress) {
    if (addressSwaps.length < 2) continue;

    for (let i = 0; i < addressSwaps.length; i++) {
      const a = addressSwaps[i];
      for (let j = i + 1; j < addressSwaps.length; j++) {
        const b = addressSwaps[j];
        if (a.transactionHash === b.transactionHash) continue; // atomic — covered by arbitrage classifier
        if (a.contractAddress === b.contractAddress) continue; // same pool, not a real route
        if (a.tokenInAddress !== b.tokenOutAddress) continue;
        if (a.tokenOutAddress !== b.tokenInAddress) continue;

        // Require the connecting leg to be roughly the same size, or this isn't
        // one continuous round-trip of the same capital.
        const outA = Number(a.tokenOutAmount);
        const inB = Number(b.tokenInAmount);
        if (outA <= 0 || inB <= 0) continue;
        const sizeRatio = Math.min(outA, inB) / Math.max(outA, inB);
        if (sizeRatio < 0.7) continue;

        const profit = b.tokenOutAmount - a.tokenInAmount;
        if (profit <= 0n) continue;

        results.push({
          blockNumber,
          address,
          firstTxHash: a.transactionHash,
          secondTxHash: b.transactionHash,
          tokenAddress: a.tokenInAddress,
          profitAmount: profit,
        });
      }
    }
  }

  return results;
}

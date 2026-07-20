// Moved in-pipeline from apps/explorer-api/src/detectors/liquidationSandwich.ts
// (ADR-010). Liquidator runs a setup swap before its own liquidation (and maybe
// reverses it after). Tx ordering comes from miner_payments' transaction_index,
// which writeBlock keeps equal to swaps.transaction_position (audit fix B4).
import type { Liquidation, LiquidationSandwichEvent, MinerPayment, Swap } from "../types.js";

export function detectLiquidationSandwiches(
  blockNumber: number,
  liquidations: Liquidation[],
  swaps: Swap[],
  minerPayments: MinerPayment[],
): LiquidationSandwichEvent[] {
  const successful = liquidations.filter((l) => l.error === null);
  if (successful.length === 0) return [];

  const positionByTx = new Map<string, number>(
    minerPayments.map((p) => [p.transactionHash, p.transactionIndex]),
  );

  const results: LiquidationSandwichEvent[] = [];
  for (const liq of successful) {
    const liqPosition = positionByTx.get(liq.transactionHash);
    if (liqPosition == null) continue;

    const precedingSwaps = swaps.filter(
      (s) =>
        s.fromAddress === liq.liquidatorUser &&
        s.transactionPosition < liqPosition &&
        s.transactionHash !== liq.transactionHash,
    );
    if (precedingSwaps.length === 0) continue;

    const setupSwap =
      precedingSwaps.find(
        (s) =>
          s.tokenInAddress === liq.debtTokenAddress ||
          s.tokenOutAddress === liq.debtTokenAddress ||
          s.tokenInAddress === liq.receivedTokenAddress ||
          s.tokenOutAddress === liq.receivedTokenAddress,
      ) ?? precedingSwaps[0];

    const reverseSwap = swaps.find(
      (s) => s.fromAddress === liq.liquidatorUser && s.transactionPosition > liqPosition,
    );

    results.push({
      blockNumber,
      liquidator: liq.liquidatorUser,
      liquidationTxHash: liq.transactionHash,
      setupSwapTxHash: setupSwap.transactionHash,
      reverseSwapTxHash: reverseSwap ? reverseSwap.transactionHash : null,
    });
  }

  return results;
}

import { pool } from "@mev/db";

// Liquidation sandwich: the liquidator pushes a position underwater with a
// swap that moves the price an oracle or AMM-based health check reads, then
// liquidates it for a discount in the same block - sometimes reversing the
// setup swap afterward to limit their own price exposure. A documented but
// rarely-detected MEV pattern (Materwala et al. 2024 cite only one prior
// heuristic, Xiong et al., across the whole survey).

export interface LiquidationSandwichEvent {
  liquidator: string;
  liquidationTxHash: string;
  setupSwapTxHash: string;
  reverseSwapTxHash: string | null;
}

export async function getLiquidationSandwichesForBlock(
  blockNumber: number,
): Promise<LiquidationSandwichEvent[]> {
  const { rows: liqRows } = await pool.query(
    `SELECT transaction_hash, liquidator_user, debt_token_address, received_token_address
     FROM liquidations WHERE block_number = $1 AND error IS NULL`,
    [blockNumber],
  );
  if (liqRows.length === 0) return [];

  const { rows: payments } = await pool.query(
    "SELECT transaction_hash, transaction_index FROM miner_payments WHERE block_number = $1",
    [blockNumber],
  );
  const positionByTx = new Map<string, number>(
    payments.map((p) => [p.transaction_hash, Number(p.transaction_index)]),
  );

  const { rows: swapRows } = await pool.query(
    `SELECT transaction_hash, transaction_position, from_address, token_in_address, token_out_address
     FROM swaps WHERE block_number = $1`,
    [blockNumber],
  );

  const results: LiquidationSandwichEvent[] = [];
  for (const liq of liqRows) {
    const liqPosition = positionByTx.get(liq.transaction_hash);
    if (liqPosition == null) continue;

    const precedingSwaps = swapRows.filter(
      (s) =>
        s.from_address === liq.liquidator_user &&
        Number(s.transaction_position) < liqPosition &&
        s.transaction_hash !== liq.transaction_hash,
    );
    if (precedingSwaps.length === 0) continue;

    const setupSwap =
      precedingSwaps.find(
        (s) =>
          s.token_in_address === liq.debt_token_address ||
          s.token_out_address === liq.debt_token_address ||
          s.token_in_address === liq.received_token_address ||
          s.token_out_address === liq.received_token_address,
      ) || precedingSwaps[0];

    const reverseSwap = swapRows.find(
      (s) => s.from_address === liq.liquidator_user && Number(s.transaction_position) > liqPosition,
    );

    results.push({
      liquidator: liq.liquidator_user,
      liquidationTxHash: liq.transaction_hash,
      setupSwapTxHash: setupSwap.transaction_hash,
      reverseSwapTxHash: reverseSwap ? reverseSwap.transaction_hash : null,
    });
  }

  return results;
}

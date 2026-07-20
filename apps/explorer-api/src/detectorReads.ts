// Reads the custom-detector results the native inspector now persists per block
// (ADR-010). The detectors themselves moved into @mev/inspect and run in the
// pipeline; these functions replace the old post-hoc SQL detectors in
// ./detectors/*, keeping the exact event shapes getBlockMev consumes so the
// merge logic in mev.ts is unchanged. NUMERIC columns come back as strings.
import { pool } from "@mev/db";

export async function getJitLiquidityForBlock(blockNumber: number) {
  const { rows } = await pool.query(
    `SELECT sender, mint_tx_hash, decrease_tx_hash, token0, token1, fee,
            swaps_between, matching_pool_swaps
     FROM mev_jit_liquidity WHERE block_number = $1`,
    [blockNumber],
  );
  return rows.map((r) => ({
    sender: r.sender,
    mintTxHash: r.mint_tx_hash,
    decreaseTxHash: r.decrease_tx_hash,
    token0: r.token0,
    token1: r.token1,
    fee: r.fee === null ? null : Number(r.fee),
    swapsBetween: Number(r.swaps_between),
    matchingPoolSwaps: Number(r.matching_pool_swaps),
  }));
}

export async function getNonAtomicArbitrageForBlock(blockNumber: number) {
  const { rows } = await pool.query(
    `SELECT address, first_tx_hash, second_tx_hash, token_address, profit_amount
     FROM mev_non_atomic_arbitrages WHERE block_number = $1`,
    [blockNumber],
  );
  return rows.map((r) => ({
    address: r.address,
    firstTxHash: r.first_tx_hash,
    secondTxHash: r.second_tx_hash,
    tokenAddress: r.token_address,
    profitRaw: r.profit_amount as string,
  }));
}

export async function getLiquidationSandwichesForBlock(blockNumber: number) {
  const { rows } = await pool.query(
    `SELECT liquidator, liquidation_tx_hash, setup_swap_tx_hash, reverse_swap_tx_hash
     FROM mev_liquidation_sandwiches WHERE block_number = $1`,
    [blockNumber],
  );
  return rows.map((r) => ({
    liquidator: r.liquidator,
    liquidationTxHash: r.liquidation_tx_hash,
    setupSwapTxHash: r.setup_swap_tx_hash,
    reverseSwapTxHash: r.reverse_swap_tx_hash as string | null,
  }));
}

export async function getLiquidationRacesForBlock(blockNumber: number) {
  const { rows } = await pool.query(
    `SELECT borrower, winner_tx_hash, winner_address, loser_tx_hashes
     FROM mev_liquidation_races WHERE block_number = $1`,
    [blockNumber],
  );
  return rows.map((r) => ({
    borrower: r.borrower,
    winnerTxHash: r.winner_tx_hash,
    winnerAddress: r.winner_address,
    loserTxHashes: r.loser_tx_hashes as string[],
  }));
}

export async function getNftFlipsForBlock(blockNumber: number) {
  const { rows } = await pool.query(
    `SELECT flipper, collection_address, token_id, buy_tx_hash, sell_tx_hash,
            profit_amount, profit_token_address
     FROM mev_nft_flips WHERE block_number = $1`,
    [blockNumber],
  );
  return rows.map((r) => ({
    flipper: r.flipper,
    collectionAddress: r.collection_address,
    tokenId: r.token_id as string,
    buyTxHash: r.buy_tx_hash,
    sellTxHash: r.sell_tx_hash,
    profitRaw: r.profit_amount as string,
    profitTokenAddress: r.profit_token_address,
  }));
}

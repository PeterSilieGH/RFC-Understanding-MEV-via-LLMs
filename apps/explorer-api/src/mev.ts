import { pool } from "@mev/db";
import {
  getJitLiquidityForBlock,
  getLiquidationRacesForBlock,
  getLiquidationSandwichesForBlock,
  getNftFlipsForBlock,
  getNonAtomicArbitrageForBlock,
} from "./detectorReads.js";
import { recordMempoolClassifications } from "./mempoolStats.js";
import * as mempoolWatcher from "./mempoolWatcher.js";
import { type FormattedAmount, formatAmount, getTokenInfo } from "./tokens.js";

// One entry in a transaction's merged mev[] array. The fields differ per
// detector; the reference implementation attaches them dynamically, so this
// stays an open record keyed by `type` (faithful port, ADR-003).
export interface MevEntry {
  type: string;
  [key: string]: unknown;
}

export interface BlockSwap {
  protocol: string | null;
  contractAddress: string;
  // mev-inspect-py trace path of the swap call, e.g. [0,1,2] - joins onto
  // trace-graph node ids ("0.1.2"), which is how the trace view locates the
  // pool call for a swap (M4 enrichment).
  traceAddress: number[];
  tokenInAddress: string | null;
  tokenInAmountRaw: string | null;
  tokenOutAddress: string | null;
  tokenOutAmountRaw: string | null;
  error: string | null;
  tokenIn?: FormattedAmount | null;
  tokenOut?: FormattedAmount | null;
}

export interface BlockTransaction {
  hash: string;
  index: number | null;
  from: string | null;
  to: string | null;
  minerAddress?: string | null;
  coinbaseTransferWei?: string | null;
  gasPriceWei?: string | null;
  gasUsed?: string | null;
  baseFeePerGasWei?: string | null;
  coinbaseTransferEth?: number;
  gasPriceGwei?: number | null;
  mempool?: mempoolWatcher.MempoolClassification;
  swaps: BlockSwap[];
  mev: MevEntry[];
}

export async function getBlockMev(blockNumber: number): Promise<BlockTransaction[]> {
  const [
    blockRow,
    txRows,
    arbitrageRows,
    sandwichRows,
    sandwichedSwapRows,
    liquidationRows,
    swapRows,
    nftTradeRows,
    jitEvents,
    nonAtomicArbEvents,
    liquidationSandwiches,
    liquidationRaces,
    nftFlips,
  ] = await Promise.all([
    pool.query(
      `SELECT EXTRACT(EPOCH FROM block_timestamp) AS unix_ts
       FROM blocks WHERE block_number = $1`,
      [blockNumber],
    ),
    pool.query(
      `SELECT transaction_hash, transaction_index, transaction_from_address,
              transaction_to_address, miner_address, coinbase_transfer,
              gas_price, gas_used, base_fee_per_gas
       FROM miner_payments WHERE block_number = $1
       ORDER BY transaction_index ASC`,
      [blockNumber],
    ),
    pool.query(
      `SELECT transaction_hash, account_address, profit_token_address,
              start_amount, end_amount, profit_amount, protocols, error
       FROM arbitrages WHERE block_number = $1`,
      [blockNumber],
    ),
    pool.query(
      `SELECT id, sandwicher_address, frontrun_swap_transaction_hash,
              backrun_swap_transaction_hash, profit_token_address, profit_amount
       FROM sandwiches WHERE block_number = $1`,
      [blockNumber],
    ),
    pool.query(
      `SELECT sandwich_id, transaction_hash
       FROM sandwiched_swaps WHERE block_number = $1`,
      [blockNumber],
    ),
    pool.query(
      `SELECT transaction_hash, liquidated_user, liquidator_user,
              debt_token_address, debt_purchase_amount, received_amount,
              received_token_address, protocol, error
       FROM liquidations WHERE block_number = $1`,
      [blockNumber],
    ),
    pool.query(
      `SELECT transaction_hash, protocol, contract_address, trace_address,
              token_in_address, token_in_amount, token_out_address,
              token_out_amount, error
       FROM swaps WHERE block_number = $1`,
      [blockNumber],
    ),
    pool.query(
      `SELECT transaction_hash, protocol, seller_address, buyer_address,
              payment_token_address, payment_amount, collection_address, token_id
       FROM nft_trades WHERE block_number = $1`,
      [blockNumber],
    ),
    getJitLiquidityForBlock(blockNumber),
    getNonAtomicArbitrageForBlock(blockNumber),
    getLiquidationSandwichesForBlock(blockNumber),
    getLiquidationRacesForBlock(blockNumber),
    getNftFlipsForBlock(blockNumber),
  ]);

  const byTx = new Map<string, BlockTransaction>();
  for (const tx of txRows.rows) {
    byTx.set(tx.transaction_hash, {
      hash: tx.transaction_hash,
      index: Number(tx.transaction_index),
      from: tx.transaction_from_address,
      to: tx.transaction_to_address,
      minerAddress: tx.miner_address,
      coinbaseTransferWei: tx.coinbase_transfer,
      gasPriceWei: tx.gas_price,
      gasUsed: tx.gas_used,
      baseFeePerGasWei: tx.base_fee_per_gas,
      swaps: [],
      mev: [],
    });
  }

  function entry(hash: string): BlockTransaction {
    let tx = byTx.get(hash);
    if (!tx) {
      tx = { hash, index: null, from: null, to: null, swaps: [], mev: [] };
      byTx.set(hash, tx);
    }
    return tx;
  }

  for (const row of swapRows.rows) {
    entry(row.transaction_hash).swaps.push({
      protocol: row.protocol,
      contractAddress: row.contract_address,
      traceAddress: (row.trace_address ?? []).map(Number),
      tokenInAddress: row.token_in_address,
      tokenInAmountRaw: row.token_in_amount,
      tokenOutAddress: row.token_out_address,
      tokenOutAmountRaw: row.token_out_amount,
      error: row.error,
    });
  }

  for (const row of arbitrageRows.rows) {
    entry(row.transaction_hash).mev.push({
      type: "arbitrage",
      accountAddress: row.account_address,
      profitTokenAddress: row.profit_token_address,
      profitAmountRaw: row.profit_amount,
      startAmountRaw: row.start_amount,
      endAmountRaw: row.end_amount,
      protocols: row.protocols,
      error: row.error,
    });
  }

  const sandwichedByTx = new Map<string, Set<string>>();
  for (const row of sandwichedSwapRows.rows) {
    if (!sandwichedByTx.has(row.sandwich_id)) sandwichedByTx.set(row.sandwich_id, new Set());
    sandwichedByTx.get(row.sandwich_id)!.add(row.transaction_hash);
  }

  for (const row of sandwichRows.rows) {
    const victims = [...(sandwichedByTx.get(row.id) || [])];

    entry(row.frontrun_swap_transaction_hash).mev.push({
      type: "sandwich_frontrun",
      sandwichId: row.id,
      sandwicherAddress: row.sandwicher_address,
      profitTokenAddress: row.profit_token_address,
      profitAmountRaw: row.profit_amount,
      counterpartTxHash: row.backrun_swap_transaction_hash,
      victimTxHashes: victims,
    });
    entry(row.backrun_swap_transaction_hash).mev.push({
      type: "sandwich_backrun",
      sandwichId: row.id,
      sandwicherAddress: row.sandwicher_address,
      profitTokenAddress: row.profit_token_address,
      profitAmountRaw: row.profit_amount,
      counterpartTxHash: row.frontrun_swap_transaction_hash,
      victimTxHashes: victims,
    });
    for (const victimHash of victims) {
      entry(victimHash).mev.push({
        type: "sandwiched_victim",
        sandwichId: row.id,
        sandwicherAddress: row.sandwicher_address,
        // let a victim's page resolve the whole incident (ADR-008 workspace)
        frontrunTxHash: row.frontrun_swap_transaction_hash,
        backrunTxHash: row.backrun_swap_transaction_hash,
        victimTxHashes: victims,
      });
    }
  }

  for (const row of liquidationRows.rows) {
    entry(row.transaction_hash).mev.push({
      type: "liquidation",
      liquidatedUser: row.liquidated_user,
      liquidatorUser: row.liquidator_user,
      debtTokenAddress: row.debt_token_address,
      debtPurchaseAmountRaw: row.debt_purchase_amount,
      receivedTokenAddress: row.received_token_address,
      receivedAmountRaw: row.received_amount,
      protocol: row.protocol,
      error: row.error,
    });
  }

  for (const row of nftTradeRows.rows) {
    entry(row.transaction_hash).mev.push({
      type: "nft_trade",
      protocol: row.protocol,
      sellerAddress: row.seller_address,
      buyerAddress: row.buyer_address,
      paymentTokenAddress: row.payment_token_address,
      paymentAmountRaw: row.payment_amount,
      collectionAddress: row.collection_address,
      tokenId: row.token_id,
    });
  }

  for (const jit of jitEvents) {
    const [token0, token1] = await Promise.all([
      getTokenInfo(jit.token0),
      getTokenInfo(jit.token1),
    ]);
    const pairLabel = `${token0.symbol}/${token1.symbol}`;

    entry(jit.mintTxHash).mev.push({
      type: "jit_liquidity_add",
      sender: jit.sender,
      pairLabel,
      counterpartTxHash: jit.decreaseTxHash,
      swapsBetween: jit.swapsBetween,
    });
    entry(jit.decreaseTxHash).mev.push({
      type: "jit_liquidity_remove",
      sender: jit.sender,
      pairLabel,
      counterpartTxHash: jit.mintTxHash,
      swapsBetween: jit.swapsBetween,
    });
  }

  for (const arb of nonAtomicArbEvents) {
    entry(arb.firstTxHash).mev.push({
      type: "non_atomic_arbitrage_open",
      accountAddress: arb.address,
      profitAmountRaw: arb.profitRaw,
      profitTokenAddress: arb.tokenAddress,
      counterpartTxHash: arb.secondTxHash,
    });
    entry(arb.secondTxHash).mev.push({
      type: "non_atomic_arbitrage_close",
      accountAddress: arb.address,
      profitAmountRaw: arb.profitRaw,
      profitTokenAddress: arb.tokenAddress,
      counterpartTxHash: arb.firstTxHash,
    });
  }

  for (const ls of liquidationSandwiches) {
    entry(ls.setupSwapTxHash).mev.push({
      type: "liquidation_sandwich_setup",
      liquidatorAddress: ls.liquidator,
      counterpartTxHash: ls.liquidationTxHash,
    });
    entry(ls.liquidationTxHash).mev.push({
      type: "liquidation_sandwich_liquidate",
      liquidatorAddress: ls.liquidator,
      counterpartTxHash: ls.setupSwapTxHash,
      reverseTxHash: ls.reverseSwapTxHash,
    });
    if (ls.reverseSwapTxHash) {
      entry(ls.reverseSwapTxHash).mev.push({
        type: "liquidation_sandwich_reverse",
        liquidatorAddress: ls.liquidator,
        counterpartTxHash: ls.liquidationTxHash,
      });
    }
  }

  for (const race of liquidationRaces) {
    entry(race.winnerTxHash).mev.push({
      type: "liquidation_race_won",
      borrowerAddress: race.borrower,
      loserTxHashes: race.loserTxHashes,
    });
    for (const loserTxHash of race.loserTxHashes) {
      entry(loserTxHash).mev.push({
        type: "liquidation_race_lost",
        borrowerAddress: race.borrower,
        winnerTxHash: race.winnerTxHash,
        winnerAddress: race.winnerAddress,
      });
    }
  }

  for (const flip of nftFlips) {
    entry(flip.buyTxHash).mev.push({
      type: "nft_flip_buy",
      flipperAddress: flip.flipper,
      collectionAddress: flip.collectionAddress,
      tokenId: flip.tokenId,
      counterpartTxHash: flip.sellTxHash,
      profitAmountRaw: flip.profitRaw,
      profitTokenAddress: flip.profitTokenAddress,
    });
    entry(flip.sellTxHash).mev.push({
      type: "nft_flip_sell",
      flipperAddress: flip.flipper,
      collectionAddress: flip.collectionAddress,
      tokenId: flip.tokenId,
      counterpartTxHash: flip.buyTxHash,
      profitAmountRaw: flip.profitRaw,
      profitTokenAddress: flip.profitTokenAddress,
    });
  }

  const txs = [...byTx.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const blockTimestampMs =
    blockRow.rows.length > 0 ? Number(blockRow.rows[0].unix_ts) * 1000 : null;

  await Promise.all(
    txs.map(async (tx) => {
      tx.coinbaseTransferEth = tx.coinbaseTransferWei ? Number(tx.coinbaseTransferWei) / 1e18 : 0;
      tx.gasPriceGwei = tx.gasPriceWei ? Number(tx.gasPriceWei) / 1e9 : null;

      tx.mempool =
        blockTimestampMs !== null
          ? mempoolWatcher.classify(tx.hash, blockTimestampMs)
          : { status: "unknown", secondsInMempool: null, firstSeenAtMs: null };

      for (const swap of tx.swaps) {
        swap.tokenIn = await formatAmount(swap.tokenInAmountRaw, swap.tokenInAddress);
        swap.tokenOut = await formatAmount(swap.tokenOutAmountRaw, swap.tokenOutAddress);
      }

      for (const m of tx.mev) {
        if (m.profitAmountRaw !== undefined) {
          m.profit = await formatAmount(
            m.profitAmountRaw as string | null,
            m.profitTokenAddress as string | null,
          );
        }
        if (m.debtPurchaseAmountRaw !== undefined) {
          m.debtPurchase = await formatAmount(
            m.debtPurchaseAmountRaw as string | null,
            m.debtTokenAddress as string | null,
          );
        }
        if (m.receivedAmountRaw !== undefined) {
          m.received = await formatAmount(
            m.receivedAmountRaw as string | null,
            m.receivedTokenAddress as string | null,
          );
        }
        if (m.paymentAmountRaw !== undefined) {
          m.payment = await formatAmount(
            m.paymentAmountRaw as string | null,
            m.paymentTokenAddress as string | null,
          );
        }
      }
    }),
  );

  // fire-and-forget: persisting mempool sightings must never slow or fail a
  // block view (the watcher forgets them after 2 minutes, this doesn't)
  void recordMempoolClassifications(blockNumber, txs).catch(() => {});

  return txs;
}

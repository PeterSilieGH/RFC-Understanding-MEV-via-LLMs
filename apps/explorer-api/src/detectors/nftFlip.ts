import { pool } from "@mev/db";

// NFT flip: the same address buys a specific NFT and resells that exact
// token (same collection + token ID) within the same block, at a profit.
// mev-inspect-py's nft_trades table records each leg as an independent
// trade with no link between them - this connects the two and computes the
// round-trip profit, the NFT-market analog of atomic arbitrage.

export interface NftFlipEvent {
  flipper: string;
  collectionAddress: string;
  tokenId: string;
  buyTxHash: string;
  sellTxHash: string;
  profitRaw: string;
  profitTokenAddress: string;
}

interface TradeRow {
  transaction_hash: string;
  transaction_position: string;
  collection_address: string;
  token_id: string;
  buyer_address: string;
  seller_address: string;
  payment_token_address: string;
  payment_amount: string;
}

export async function getNftFlipsForBlock(blockNumber: number): Promise<NftFlipEvent[]> {
  const { rows } = await pool.query<TradeRow>(
    `SELECT transaction_hash, transaction_position, collection_address, token_id,
            buyer_address, seller_address, payment_token_address, payment_amount
     FROM nft_trades WHERE block_number = $1 AND error IS NULL ORDER BY transaction_position ASC`,
    [blockNumber],
  );

  const byAsset = new Map<string, TradeRow[]>();
  for (const r of rows) {
    const key = `${r.collection_address}:${r.token_id}`;
    if (!byAsset.has(key)) byAsset.set(key, []);
    byAsset.get(key)!.push(r);
  }

  const results: NftFlipEvent[] = [];
  for (const trades of byAsset.values()) {
    if (trades.length < 2) continue;

    for (let i = 0; i < trades.length; i++) {
      const buy = trades[i];
      for (let j = i + 1; j < trades.length; j++) {
        const sell = trades[j];
        if (buy.transaction_hash === sell.transaction_hash) continue;
        if (buy.buyer_address !== sell.seller_address) continue; // same flipper on both legs
        if (buy.payment_token_address !== sell.payment_token_address) continue; // compare in the same currency

        let profit: bigint;
        try {
          profit = BigInt(sell.payment_amount) - BigInt(buy.payment_amount);
        } catch {
          continue;
        }
        if (profit <= 0n) continue;

        results.push({
          flipper: buy.buyer_address,
          collectionAddress: buy.collection_address,
          tokenId: buy.token_id,
          buyTxHash: buy.transaction_hash,
          sellTxHash: sell.transaction_hash,
          profitRaw: profit.toString(),
          profitTokenAddress: buy.payment_token_address,
        });
        break; // this token was resold - don't also try pairing the buy with a later resale of the resale
      }
    }
  }

  return results;
}

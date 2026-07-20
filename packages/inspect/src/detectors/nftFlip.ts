// Moved in-pipeline from apps/explorer-api/src/detectors/nftFlip.ts (ADR-010).
// Same address buys and resells the exact NFT within one block at a profit.
import type { NftFlipEvent, NftTrade } from "../types.js";

export function detectNftFlips(blockNumber: number, nftTrades: NftTrade[]): NftFlipEvent[] {
  const ordered = [...nftTrades].sort((a, b) => a.transactionPosition - b.transactionPosition);

  const byAsset = new Map<string, NftTrade[]>();
  for (const trade of ordered) {
    if (trade.error !== null) continue;
    const key = `${trade.collectionAddress}:${trade.tokenId}`;
    const list = byAsset.get(key);
    if (list) list.push(trade);
    else byAsset.set(key, [trade]);
  }

  const results: NftFlipEvent[] = [];
  for (const trades of byAsset.values()) {
    if (trades.length < 2) continue;

    for (let i = 0; i < trades.length; i++) {
      const buy = trades[i];
      for (let j = i + 1; j < trades.length; j++) {
        const sell = trades[j];
        if (buy.transactionHash === sell.transactionHash) continue;
        if (buy.buyerAddress !== sell.sellerAddress) continue; // same flipper both legs
        if (buy.paymentTokenAddress !== sell.paymentTokenAddress) continue; // compare same currency

        const profit = sell.paymentAmount - buy.paymentAmount;
        if (profit <= 0n) continue;

        results.push({
          blockNumber,
          flipper: buy.buyerAddress,
          collectionAddress: buy.collectionAddress,
          tokenId: buy.tokenId,
          buyTxHash: buy.transactionHash,
          sellTxHash: sell.transactionHash,
          profitAmount: profit,
          profitTokenAddress: buy.paymentTokenAddress,
        });
        break; // this token was resold — don't pair the buy with a later resale
      }
    }
  }

  return results;
}

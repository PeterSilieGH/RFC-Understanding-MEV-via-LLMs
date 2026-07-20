// Ports mev_inspect/nft_trades.py. Each `nft_trade`-classified call is turned
// into an NftTrade by the protocol's NftTradeClassifier, using the child
// transfers (deduped of their own nested transfers).
import { getClassifier } from "./classifiers/registry.js";
import { compareTraceAddress, getTracesByTransactionHash } from "./traces.js";
import { getChildTransfers, removeChildTransfersOfTransfers } from "./transfers.js";
import { type ClassifiedTrace, type NftTrade, isDecodedCall } from "./types.js";

export function getNftTrades(traces: ClassifiedTrace[]): NftTrade[] {
  const nftTrades: NftTrade[] = [];
  for (const transactionTraces of getTracesByTransactionHash(traces).values()) {
    nftTrades.push(...getNftTradesForTransaction(transactionTraces));
  }
  return nftTrades;
}

function getNftTradesForTransaction(traces: ClassifiedTrace[]): NftTrade[] {
  const ordered = [...traces].sort((a, b) => compareTraceAddress(a.traceAddress, b.traceAddress));
  const nftTrades: NftTrade[] = [];

  for (const trace of ordered) {
    if (!isDecodedCall(trace)) continue;
    if (trace.classification !== "nft_trade") continue;

    const childTransfers = getChildTransfers(trace.transactionHash, trace.traceAddress, traces);
    const classifier = getClassifier(trace);
    if (classifier !== null && classifier.classification === "nft_trade") {
      const nftTrade = classifier.parseTrade(
        trace,
        removeChildTransfersOfTransfers(childTransfers),
      );
      if (nftTrade !== null) nftTrades.push(nftTrade);
    }
  }

  return nftTrades;
}

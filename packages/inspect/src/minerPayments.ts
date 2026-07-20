// Ports mev_inspect/miner_payments.py. Per transaction: base gas cost plus any
// direct ETH transfers to the miner (coinbase transfers). Uses the receipt for
// effective gas price / gas used and the first trace for the tx to/from.
import { compareTraceAddress, getTracesByTransactionHash } from "./traces.js";
import { filterTransfers, getEthTransfers } from "./transfers.js";
import type { ClassifiedTrace, MinerPayment, Receipt } from "./types.js";

export function getMinerPayments(
  minerAddress: string,
  baseFeePerGas: bigint,
  traces: ClassifiedTrace[],
  receipts: Receipt[],
): MinerPayment[] {
  const minerPayments: MinerPayment[] = [];
  const tracesByTransactionHash = getTracesByTransactionHash(traces);
  const miner = minerAddress.toLowerCase();

  for (const receipt of receipts) {
    const transactionTraces = tracesByTransactionHash.get(receipt.transactionHash) ?? [];
    if (transactionTraces.length === 0) continue;

    const firstTrace = [...transactionTraces].sort((a, b) =>
      compareTraceAddress(a.traceAddress, b.traceAddress),
    )[0];

    const minerEthTransfers = filterTransfers(getEthTransfers(transactionTraces), {
      toAddress: miner,
    });
    const coinbaseTransfer = minerEthTransfers.reduce((sum, t) => sum + t.amount, 0n);

    const gasCost = receipt.effectiveGasPrice * receipt.gasUsed;
    const totalGasCost = gasCost + coinbaseTransfer;
    const gasPriceWithCoinbaseTransfer =
      receipt.gasUsed !== 0n ? totalGasCost / receipt.gasUsed : 0n;

    minerPayments.push({
      minerAddress: miner,
      blockNumber: receipt.blockNumber,
      transactionHash: receipt.transactionHash,
      transactionIndex: receipt.transactionIndex,
      gasPrice: receipt.effectiveGasPrice,
      gasPriceWithCoinbaseTransfer,
      baseFeePerGas,
      gasUsed: receipt.gasUsed,
      coinbaseTransfer,
      transactionToAddress: firstTrace.toAddress,
      transactionFromAddress: firstTrace.fromAddress,
    });
  }

  return minerPayments;
}

// Ports mev_inspect/swaps.py. Walks each transaction's traces in trace-address
// order, accumulating transfers, and asks a SwapClassifier to build a Swap from
// the transfers surrounding each swap-classified call.
import { getClassifier } from "./classifiers/registry.js";
import { compareTraceAddress, getTracesByTransactionHash } from "./traces.js";
import { getChildTransfers, getTransfer, removeChildTransfersOfTransfers } from "./transfers.js";
import {
  type ClassifiedTrace,
  type DecodedCallTrace,
  type Swap,
  type Transfer,
  isDecodedCall,
} from "./types.js";

export function getSwaps(traces: ClassifiedTrace[]): Swap[] {
  const swaps: Swap[] = [];
  for (const transactionTraces of getTracesByTransactionHash(traces).values()) {
    swaps.push(...getSwapsForTransaction(transactionTraces));
  }
  return swaps;
}

function getSwapsForTransaction(traces: ClassifiedTrace[]): Swap[] {
  const ordered = [...traces].sort((a, b) => compareTraceAddress(a.traceAddress, b.traceAddress));
  const swaps: Swap[] = [];
  const priorTransfers: Transfer[] = [];

  for (const trace of ordered) {
    if (!isDecodedCall(trace)) continue;

    if (trace.classification === "transfer") {
      const transfer = getTransfer(trace);
      if (transfer !== null) priorTransfers.push(transfer);
    } else if (trace.classification === "swap") {
      const childTransfers = getChildTransfers(trace.transactionHash, trace.traceAddress, traces);
      const swap = parseSwap(
        trace,
        removeChildTransfersOfTransfers(priorTransfers),
        removeChildTransfersOfTransfers(childTransfers),
      );
      if (swap !== null) swaps.push(swap);
    }
  }

  return swaps;
}

function parseSwap(
  trace: DecodedCallTrace,
  priorTransfers: Transfer[],
  childTransfers: Transfer[],
): Swap | null {
  const classifier = getClassifier(trace);
  if (classifier !== null && classifier.classification === "swap") {
    return classifier.parseSwap(trace, priorTransfers, childTransfers);
  }
  return null;
}

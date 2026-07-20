import { filterTransfers } from "./classifiers/helpers.js";
// Ports mev_inspect/transfers.py. Transfers are reconstructed from the call
// traces themselves (not event logs): a simple ETH value-transfer, or a decoded
// ERC-20 transfer/transferFrom handled by a TransferClassifier.
import { getClassifier } from "./classifiers/registry.js";
import { compareTraceAddress, getChildTraces, isChildTraceAddress } from "./traces.js";
import { type ClassifiedTrace, ETH_TOKEN_ADDRESS, type Transfer, isDecodedCall } from "./types.js";

export { filterTransfers };

export function getTransfers(traces: ClassifiedTrace[]): Transfer[] {
  const transfers: Transfer[] = [];
  for (const trace of traces) {
    const transfer = getTransfer(trace);
    if (transfer !== null) transfers.push(transfer);
  }
  return transfers;
}

export function getEthTransfers(traces: ClassifiedTrace[]): Transfer[] {
  return getTransfers(traces).filter((t) => t.tokenAddress === ETH_TOKEN_ADDRESS);
}

export function getTransfer(trace: ClassifiedTrace): Transfer | null {
  if (isSimpleEthTransfer(trace)) return buildEthTransfer(trace);
  if (isDecodedCall(trace)) {
    const classifier = getClassifier(trace);
    if (classifier !== null && classifier.classification === "transfer") {
      return classifier.getTransfer(trace);
    }
  }
  return null;
}

function isSimpleEthTransfer(trace: ClassifiedTrace): boolean {
  return (
    trace.value !== null &&
    trace.value > 0n &&
    typeof trace.action.input === "string" &&
    trace.action.input === "0x"
  );
}

function buildEthTransfer(trace: ClassifiedTrace): Transfer {
  return {
    blockNumber: trace.blockNumber,
    transactionHash: trace.transactionHash,
    traceAddress: trace.traceAddress,
    amount: trace.value ?? 0n,
    toAddress: trace.toAddress ?? "",
    fromAddress: trace.fromAddress ?? "",
    tokenAddress: ETH_TOKEN_ADDRESS,
  };
}

export function getChildTransfers(
  transactionHash: string,
  parentTraceAddress: number[],
  traces: ClassifiedTrace[],
): Transfer[] {
  const transfers: Transfer[] = [];
  for (const childTrace of getChildTraces(transactionHash, parentTraceAddress, traces)) {
    const transfer = getTransfer(childTrace);
    if (transfer !== null) transfers.push(transfer);
  }
  return transfers;
}

export function removeChildTransfersOfTransfers(transfers: Transfer[]): Transfer[] {
  const updated: Transfer[] = [];
  const addressesByTransaction = new Map<string, number[][]>();

  const sorted = [...transfers].sort((a, b) => compareTraceAddress(a.traceAddress, b.traceAddress));

  for (const transfer of sorted) {
    const existing = addressesByTransaction.get(transfer.transactionHash) ?? [];
    const isChild = existing.some((parent) => isChildTraceAddress(transfer.traceAddress, parent));
    if (!isChild) updated.push(transfer);
    addressesByTransaction.set(transfer.transactionHash, [...existing, transfer.traceAddress]);
  }

  return updated;
}

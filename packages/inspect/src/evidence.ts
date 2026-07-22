import type {
  FundMovement,
  PutExecutionArtifact,
  PutFlowArtifact,
  TraceCall,
} from "@mev/evidence";
import type { InspectResult } from "./inspectBlock.js";
import type { ClassifiedTrace, ReceiptLog } from "./types.js";

const ERC20_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ETH_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export function buildExecutionArtifacts(result: InspectResult): PutExecutionArtifact[] {
  const byTransaction = groupByTransaction(result.classifiedTraces);
  return [...byTransaction.entries()].map(([transactionHash, traces]) => ({
    chainId: result.chainId,
    blockNumber: String(result.blockNumber),
    blockHash: result.blockHash,
    transactionHash,
    schemaVersion: 2,
    producer: "inspector",
    completeness: "complete",
    capabilities: ["call-tree", "native-value", "receipt-logs"],
    calls: traces.map((trace) => toTraceCall(trace, traces)),
  }));
}

export function buildFlowArtifacts(result: InspectResult): PutFlowArtifact[] {
  const callsByTransaction = groupByTransaction(result.classifiedTraces);
  const receipts = new Map(result.receipts.map((receipt) => [receipt.transactionHash, receipt]));
  return [...callsByTransaction.entries()].map(([transactionHash, calls]) => {
    const receipt = receipts.get(transactionHash);
    const movements: FundMovement[] = [];
    for (const call of calls) {
      const native = nativeMovement(transactionHash, call, calls);
      if (native) movements.push(native);
    }

    const logKeys = new Set<string>();
    for (const log of receipt?.logs ?? []) {
      const movement = transferLogMovement(transactionHash, log, calls, result);
      if (!movement) continue;
      logKeys.add(movementKey(movement));
      movements.push(movement);
    }
    // Some classifier fixtures/providers lack receipt logs. Preserve their
    // decoded ERC20 facts, but never duplicate a receipt-observed movement and
    // never reinterpret the ETH sentinel as a second native transfer.
    for (const transfer of result.transfers.filter((item) => item.transactionHash === transactionHash)) {
      if (transfer.tokenAddress.toLowerCase() === ETH_SENTINEL) continue;
      const movement: FundMovement = {
        id: `classified:${transactionHash}:${pathId(transfer.traceAddress)}`,
        kind: "erc20",
        tokenAddress: transfer.tokenAddress.toLowerCase(),
        traceAddress: transfer.traceAddress,
        from: transfer.fromAddress.toLowerCase(),
        to: transfer.toAddress.toLowerCase(),
        amount: transfer.amount.toString(),
        status: ancestorReverted(transfer.traceAddress, calls) ? "attempted" : "observed",
      };
      if (!logKeys.has(movementKey(movement))) movements.push(movement);
    }
    return {
      chainId: result.chainId,
      blockNumber: String(result.blockNumber),
      blockHash: result.blockHash,
      transactionHash,
      schemaVersion: 1,
      producer: "inspector",
      completeness: receipt ? "complete" : "partial",
      movements: deduplicateMovements(movements),
    };
  });
}

function toTraceCall(trace: ClassifiedTrace, transaction: ClassifiedTrace[]): TraceCall {
  return {
    traceAddress: trace.traceAddress,
    parentTraceAddress:
      trace.traceAddress.length === 0 ? null : trace.traceAddress.slice(0, trace.traceAddress.length - 1),
    callType: callKind(trace),
    from: trace.fromAddress ?? zeroAddress(),
    to: trace.toAddress,
    selector: trace.input && trace.input.length >= 10 ? trace.input.slice(0, 10).toLowerCase() : null,
    inputSize: hexBytes(trace.input),
    outputSize: trace.output === null ? null : hexBytes(trace.output),
    subtraces: trace.subtraces,
    valueWei: (trace.value ?? 0n).toString(),
    gas: trace.gas?.toString() ?? null,
    gasUsed: trace.gasUsed?.toString() ?? null,
    error: trace.error,
    reverted: ancestorReverted(trace.traceAddress, transaction),
  };
}

function nativeMovement(
  transactionHash: string,
  call: ClassifiedTrace,
  transaction: ClassifiedTrace[],
): FundMovement | undefined {
  const kind = callKind(call);
  // DELEGATECALL/STATICCALL/CALLCODE carry an execution context or call value
  // field but do not move ETH from caller to callee.
  if (kind !== "CALL" && kind !== "CREATE" && kind !== "CREATE2" && kind !== "SELFDESTRUCT") {
    return undefined;
  }
  const amount = call.value ?? 0n;
  if (amount <= 0n || !call.fromAddress || !call.toAddress) return undefined;
  return {
    id: `native:${transactionHash}:${pathId(call.traceAddress)}`,
    kind: "native",
    tokenAddress: null,
    traceAddress: call.traceAddress,
    from: call.fromAddress,
    to: call.toAddress,
    amount: amount.toString(),
    status: ancestorReverted(call.traceAddress, transaction) ? "attempted" : "observed",
  };
}

function transferLogMovement(
  transactionHash: string,
  log: ReceiptLog,
  calls: ClassifiedTrace[],
  result: InspectResult,
): FundMovement | undefined {
  if (log.topics[0] !== ERC20_TRANSFER || (log.topics.length !== 3 && log.topics.length !== 4)) {
    return undefined;
  }
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  if (!from || !to) return undefined;
  let amount: bigint;
  try {
    amount = BigInt(log.topics.length === 4 ? log.topics[3] : log.data);
  } catch {
    return undefined;
  }
  const decoded = result.transfers.find(
    (transfer) =>
      transfer.transactionHash === transactionHash &&
      transfer.tokenAddress.toLowerCase() === log.address &&
      transfer.fromAddress.toLowerCase() === from &&
      transfer.toAddress.toLowerCase() === to &&
      transfer.amount === amount,
  );
  return {
    id: `receipt:${transactionHash}:${log.logIndex}`,
    kind: log.topics.length === 4 ? "erc721" : "erc20",
    tokenAddress: log.address,
    traceAddress: decoded?.traceAddress ?? nearestTokenCall(log.address, calls),
    from,
    to,
    amount: amount.toString(),
    // A receipt log is committed transaction-observed evidence. It is never
    // downgraded because a guessed anchor call appears under a reverted frame.
    status: "observed",
  };
}

function callKind(trace: ClassifiedTrace): TraceCall["callType"] {
  if (trace.type === "create") return "CREATE";
  if (trace.type === "suicide") return "SELFDESTRUCT";
  if (trace.type !== "call") return "UNKNOWN";
  const value = trace.callType?.replace(/[_-]/g, "").toUpperCase();
  if (value === "CALL" || value === "CALLCODE" || value === "DELEGATECALL" || value === "STATICCALL") {
    return value;
  }
  return "UNKNOWN";
}

function ancestorReverted(path: number[], calls: ClassifiedTrace[]): boolean {
  return calls.some(
    (candidate) =>
      candidate.error !== null &&
      candidate.traceAddress.length <= path.length &&
      candidate.traceAddress.every((part, index) => path[index] === part),
  );
}

function groupByTransaction(values: ClassifiedTrace[]): Map<string, ClassifiedTrace[]> {
  const map = new Map<string, ClassifiedTrace[]>();
  for (const trace of values) {
    if (!/^0x[0-9a-f]{64}$/.test(trace.transactionHash)) continue;
    const current = map.get(trace.transactionHash) ?? [];
    current.push(trace);
    map.set(trace.transactionHash, current);
  }
  for (const traces of map.values()) {
    traces.sort((left, right) => comparePath(left.traceAddress, right.traceAddress));
  }
  return map;
}

function comparePath(left: number[], right: number[]): number {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

function nearestTokenCall(address: string, calls: ClassifiedTrace[]): number[] | null {
  return calls.find((call) => call.toAddress === address)?.traceAddress ?? null;
}

function topicAddress(topic: string | undefined): string | undefined {
  return topic && /^0x[0-9a-f]{64}$/.test(topic) ? `0x${topic.slice(-40)}` : undefined;
}

function hexBytes(value: string | null): number {
  return value?.startsWith("0x") ? Math.max(0, (value.length - 2) / 2) : 0;
}

function pathId(path: number[]): string {
  return path.length === 0 ? "root" : path.join(".");
}

function movementKey(movement: FundMovement): string {
  return [movement.kind, movement.tokenAddress ?? "native", movement.from, movement.to, movement.amount].join(":");
}

function deduplicateMovements(values: FundMovement[]): FundMovement[] {
  const seen = new Set<string>();
  return values.filter((movement) => {
    const key = movement.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function zeroAddress(): string {
  return "0x0000000000000000000000000000000000000000";
}

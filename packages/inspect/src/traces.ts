// Ports mev_inspect/traces.py. Trace addresses are lists of ints; ordering is
// element-wise numeric with a shorter prefix sorting first (Python list
// comparison), so [0,2] < [0,10] — a plain JS array sort would get this wrong.
import type { ClassifiedTrace } from "./types.js";

export function compareTraceAddress(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function isChildTraceAddress(child: number[], parent: number[]): boolean {
  return child.length > parent.length && parent.every((value, index) => child[index] === value);
}

export function getChildTraces(
  transactionHash: string,
  parentTraceAddress: number[],
  traces: ClassifiedTrace[],
): ClassifiedTrace[] {
  return traces
    .filter(
      (trace) =>
        trace.transactionHash === transactionHash &&
        isChildTraceAddress(trace.traceAddress, parentTraceAddress),
    )
    .sort((a, b) => compareTraceAddress(a.traceAddress, b.traceAddress));
}

export function getTracesByTransactionHash(
  traces: ClassifiedTrace[],
): Map<string, ClassifiedTrace[]> {
  const byHash = new Map<string, ClassifiedTrace[]>();
  for (const trace of traces) {
    const existing = byHash.get(trace.transactionHash);
    if (existing) existing.push(trace);
    else byHash.set(trace.transactionHash, [trace]);
  }
  return byHash;
}

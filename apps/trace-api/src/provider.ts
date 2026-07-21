// getDebugTrace pattern ported from l2beat@18532eacfff59dfa2ff9ea37d128b65c569fef40
// packages/discovery/src/discovery/provider/LowLevelProvider.ts (ADR-004):
// debug_traceTransaction with the callTracer and withLog, so the response is
// the nested call tree including event logs.
import { getProvider } from "@mev/rpc";
import { type DebugTransactionCall, parseDebugTrace } from "@mev/trace-graph";

const provider = getProvider();

// Big traces take a while, but a degraded node can also leave the call
// hanging forever - fail instead so clients see an error, not a stalled tab.
const TRACE_TIMEOUT_MS = 60_000;

// Traces are immutable once mined - cache the parsed call tree in memory.
const traceCache = new Map<string, DebugTransactionCall>();
const TRACE_CACHE_MAX = 200;

export async function getTraceCached(txHash: string): Promise<DebugTransactionCall> {
  const cached = traceCache.get(txHash);
  if (cached) return cached;
  const trace = await getDebugTrace(txHash);
  if (traceCache.size >= TRACE_CACHE_MAX) {
    const oldest = traceCache.keys().next().value;
    if (oldest) traceCache.delete(oldest);
  }
  traceCache.set(txHash, trace);
  return trace;
}

export async function getDebugTrace(transactionHash: string): Promise<DebugTransactionCall> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      provider.send("debug_traceTransaction", [
        transactionHash,
        { tracer: "callTracer", tracerConfig: { withLog: true } },
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("debug_traceTransaction timed out - RPC node degraded?")),
          TRACE_TIMEOUT_MS,
        );
      }),
    ]);
    return parseDebugTrace(response);
  } finally {
    clearTimeout(timer);
  }
}

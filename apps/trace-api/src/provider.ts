// getDebugTrace pattern ported from l2beat@18532eacfff59dfa2ff9ea37d128b65c569fef40
// packages/discovery/src/discovery/provider/LowLevelProvider.ts (ADR-004):
// debug_traceTransaction with the callTracer and withLog, so the response is
// the nested call tree including event logs.
import { getProvider } from "@mev/rpc";
import { type DebugTransactionCall, parseDebugTrace } from "@mev/trace-graph";

interface TraceRpc {
  send(method: string, params: unknown[]): Promise<unknown>;
}

// Big traces take a while, but a degraded node can also leave the call
// hanging forever - fail instead so clients see an error, not a stalled tab.
const TRACE_TIMEOUT_MS = 60_000;

// Traces are immutable once mined - cache the parsed call tree in memory.
const TRACE_CACHE_MAX = 200;

/**
 * Completed-value LRU plus an in-flight promise registry. Installing the
 * promise before awaiting the RPC is what makes concurrently mounted graph,
 * workspace, and Discovery consumers share one cold replay.
 */
export class DebugTraceCache {
  private readonly completed = new Map<string, DebugTransactionCall>();
  private readonly inFlight = new Map<string, Promise<DebugTransactionCall>>();

  constructor(
    private readonly rpc: TraceRpc,
    private readonly timeoutMs = TRACE_TIMEOUT_MS,
    private readonly maxCompleted = TRACE_CACHE_MAX,
  ) {}

  async get(txHash: string): Promise<DebugTransactionCall> {
    const key = traceKey(txHash);
    const cached = this.completed.get(key);
    if (cached) {
      // Refresh insertion order for a true, bounded LRU.
      this.completed.delete(key);
      this.completed.set(key, cached);
      return cached;
    }
    const shared = this.inFlight.get(key);
    if (shared) return shared;

    const request = this.fetch(txHash)
      .then((trace) => {
        while (this.completed.size >= this.maxCompleted) {
          const oldest = this.completed.keys().next().value as string | undefined;
          if (!oldest) break;
          this.completed.delete(oldest);
        }
        this.completed.set(key, trace);
        return trace;
      })
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }

  stats(): { completed: number; inFlight: number } {
    return { completed: this.completed.size, inFlight: this.inFlight.size };
  }

  private async fetch(transactionHash: string): Promise<DebugTransactionCall> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.rpc.send("debug_traceTransaction", [
          transactionHash,
          { tracer: "callTracer", tracerConfig: { withLog: true } },
        ]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("debug_traceTransaction timed out - RPC node degraded?")),
            this.timeoutMs,
          );
        }),
      ]);
      return parseDebugTrace(response);
    } finally {
      clearTimeout(timer);
    }
  }
}

function traceKey(txHash: string): string {
  return `eth:${txHash.toLowerCase()}:callTracer:withLog=true`;
}

const defaultCache = new DebugTraceCache(getProvider());

export function getTraceCached(txHash: string): Promise<DebugTransactionCall> {
  return defaultCache.get(txHash);
}

export async function getDebugTrace(transactionHash: string): Promise<DebugTransactionCall> {
  // Raw-detail callers intentionally bypass the completed cache, but still use
  // the same bounded tracer shape. Normal graph/workspace paths use getTraceCached.
  return new DebugTraceCache(getProvider(), TRACE_TIMEOUT_MS, 1).get(transactionHash);
}

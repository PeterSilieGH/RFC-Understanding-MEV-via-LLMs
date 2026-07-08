// Ported from l2beat@18532eacfff59dfa2ff9ea37d128b65c569fef40
// packages/discovery/src/discovery/provider/DebugTransactionTrace.ts (ADR-004),
// re-expressed with zod and extended: geth's callTracer returns the root
// frame as a call object itself (not just nested `calls`), and each log also
// carries `address` and `data`, which we need for token-transfer extraction.
import { z } from "zod";

export interface DebugTransactionLog {
  address?: string;
  topics: string[];
  data?: string;
}

export interface DebugTransactionCall {
  from: string;
  to?: string;
  input?: string;
  output?: string;
  type: string;
  value?: string;
  gas?: string;
  gasUsed?: string;
  error?: string;
  revertReason?: string;
  calls?: DebugTransactionCall[];
  logs?: DebugTransactionLog[];
}

const debugTransactionLog: z.ZodType<DebugTransactionLog> = z.object({
  address: z.string().optional(),
  topics: z.array(z.string()),
  data: z.string().optional(),
});

export const debugTransactionCall: z.ZodType<DebugTransactionCall> = z.lazy(() =>
  z.object({
    from: z.string(),
    to: z.string().optional(),
    input: z.string().optional(),
    output: z.string().optional(),
    type: z.string(),
    value: z.string().optional(),
    gas: z.string().optional(),
    gasUsed: z.string().optional(),
    error: z.string().optional(),
    revertReason: z.string().optional(),
    calls: z.array(debugTransactionCall).optional(),
    logs: z.array(debugTransactionLog).optional(),
  }),
);

/** The full response of debug_traceTransaction with the callTracer: the root call frame. */
export function parseDebugTrace(response: unknown): DebugTransactionCall {
  return debugTransactionCall.parse(response);
}

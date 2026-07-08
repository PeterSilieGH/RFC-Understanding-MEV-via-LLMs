// getDebugTrace pattern ported from l2beat@18532eacfff59dfa2ff9ea37d128b65c569fef40
// packages/discovery/src/discovery/provider/LowLevelProvider.ts (ADR-004):
// debug_traceTransaction with the callTracer and withLog, so the response is
// the nested call tree including event logs.
import { loadConfig } from "@mev/config";
import { type DebugTransactionCall, parseDebugTrace } from "@mev/trace-graph";
import { ethers } from "ethers";

const config = loadConfig();
const provider = new ethers.JsonRpcProvider(config.RPC_URL);

export async function getDebugTrace(transactionHash: string): Promise<DebugTransactionCall> {
  const response = await provider.send("debug_traceTransaction", [
    transactionHash,
    { tracer: "callTracer", tracerConfig: { withLog: true } },
  ]);
  return parseDebugTrace(response);
}

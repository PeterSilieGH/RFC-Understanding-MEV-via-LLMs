// Moved in-pipeline from apps/explorer-api/src/detectors/jitLiquidity.ts
// (ADR-010). A searcher mints a narrow-range Uniswap V3 position right before a
// big swap and removes it right after, capturing the fee with seconds of
// exposure. Heuristic: one address minting then decreasing liquidity in the same
// block with a swap in between. mint()'s decoded params carry token0/token1/fee;
// decreaseLiquidity() is keyed by tokenId only, so we use a same-block,
// same-sender match rather than the (unpersisted) event logs.
import type { ClassifiedTrace, JitLiquidityEvent, MinerPayment, Swap } from "../types.js";

const POSITION_MANAGER_ABI = "NonfungiblePositionManager";

interface MintParams {
  token0: string;
  token1: string;
  fee: bigint | null;
}

function parseMintParams(inputs: Record<string, unknown> | null): MintParams | null {
  const params = inputs?.params as unknown[] | undefined;
  if (!Array.isArray(params) || params.length < 10) return null;
  const [token0, token1, fee] = params;
  if (typeof token0 !== "string" || typeof token1 !== "string") return null;
  return { token0, token1, fee: typeof fee === "bigint" ? fee : null };
}

export function detectJitLiquidity(
  blockNumber: number,
  classifiedTraces: ClassifiedTrace[],
  swaps: Swap[],
  minerPayments: MinerPayment[],
): JitLiquidityEvent[] {
  const traces = classifiedTraces.filter(
    (t) =>
      t.abiName === POSITION_MANAGER_ABI &&
      (t.functionName === "mint" || t.functionName === "decreaseLiquidity"),
  );
  if (traces.length === 0) return [];

  const senderByTx = new Map<string, string>();
  for (const p of minerPayments) {
    if (p.transactionFromAddress) senderByTx.set(p.transactionHash, p.transactionFromAddress);
  }

  const mints: (MintParams & { sender: string; txHash: string; position: number })[] = [];
  const decreases: { sender: string; txHash: string; position: number }[] = [];
  for (const t of traces) {
    const sender = senderByTx.get(t.transactionHash);
    if (!sender) continue;
    const position = t.transactionPosition;
    if (t.functionName === "mint") {
      const parsed = parseMintParams(t.inputs);
      if (parsed) mints.push({ ...parsed, sender, txHash: t.transactionHash, position });
    } else {
      decreases.push({ sender, txHash: t.transactionHash, position });
    }
  }
  if (mints.length === 0 || decreases.length === 0) return [];

  const swapInfo = swaps.map((s) => ({
    position: s.transactionPosition,
    fromAddress: s.fromAddress,
    tokenIn: s.tokenInAddress,
    tokenOut: s.tokenOutAddress,
  }));

  const results: JitLiquidityEvent[] = [];
  for (const mint of mints) {
    const candidateDecreases = decreases.filter(
      (d) => d.sender === mint.sender && d.position > mint.position && d.txHash !== mint.txHash,
    );

    for (const decrease of candidateDecreases) {
      const between = swapInfo.filter(
        (s) =>
          s.position > mint.position &&
          s.position < decrease.position &&
          s.fromAddress !== mint.sender,
      );
      if (between.length === 0) continue;

      const matchingPoolSwaps = between.filter(
        (s) =>
          (s.tokenIn === mint.token0 && s.tokenOut === mint.token1) ||
          (s.tokenIn === mint.token1 && s.tokenOut === mint.token0),
      );

      results.push({
        blockNumber,
        sender: mint.sender,
        mintTxHash: mint.txHash,
        decreaseTxHash: decrease.txHash,
        token0: mint.token0,
        token1: mint.token1,
        fee: mint.fee,
        swapsBetween: between.length,
        matchingPoolSwaps: matchingPoolSwaps.length,
      });
    }
  }

  return results;
}

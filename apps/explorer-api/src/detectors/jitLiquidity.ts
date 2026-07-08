import { pool } from "@mev/db";

// JIT (just-in-time) liquidity: a searcher mints a large, narrow-range
// Uniswap V3 position right before a big swap lands, then removes it right
// after - capturing most of that swap's fee with only seconds of price
// exposure. mev-inspect-py already decodes every NonfungiblePositionManager
// call (it's a registered classifier spec) but never analyzes the pattern,
// so it's invisible in the existing arbitrage/sandwich/liquidation output.
//
// mint()'s calldata carries the pool's token0/token1/fee directly, but
// decreaseLiquidity()/collect() are keyed by tokenId only (no pool info) -
// matching them back to a mint by tokenId would need the Increase/DecreaseLiquidity
// event logs, which mev-inspect-py doesn't persist. Instead we use a same-block,
// same-sender heuristic: one address minting and then decreasing liquidity
// within the same block, with at least one swap in between, is not something
// a genuine long-term LP does - nobody adds and removes a position within
// seconds for no reason.
const POSITION_MANAGER_ABI = "NonfungiblePositionManager";

export interface JitLiquidityEvent {
  sender: string;
  mintTxHash: string;
  decreaseTxHash: string;
  token0: string;
  token1: string;
  fee: number;
  swapsBetween: number;
  matchingPoolSwaps: number;
}

interface MintParams {
  token0: string;
  token1: string;
  fee: number;
}

function parseMintParams(inputs: unknown): MintParams | null {
  const params = (inputs as { params?: unknown[] }[] | undefined)?.[0]?.params;
  if (!Array.isArray(params) || params.length < 10) return null;
  const [token0, token1, fee] = params;
  if (typeof token0 !== "string" || typeof token1 !== "string") return null;
  return { token0: token0.toLowerCase(), token1: token1.toLowerCase(), fee: Number(fee) };
}

export async function getJitLiquidityForBlock(blockNumber: number): Promise<JitLiquidityEvent[]> {
  const { rows: traces } = await pool.query(
    `SELECT transaction_hash, transaction_position, function_name, inputs
     FROM classified_traces
     WHERE block_number = $1 AND abi_name = $2 AND function_name IN ('mint', 'decreaseLiquidity')`,
    [blockNumber, POSITION_MANAGER_ABI],
  );
  if (traces.length === 0) return [];

  const { rows: payments } = await pool.query(
    "SELECT DISTINCT transaction_hash, transaction_from_address FROM miner_payments WHERE block_number = $1",
    [blockNumber],
  );
  const senderByTx = new Map<string, string>(
    payments.map((p) => [p.transaction_hash, p.transaction_from_address]),
  );

  const mints: (MintParams & { sender: string; txHash: string; position: number })[] = [];
  const decreases: { sender: string; txHash: string; position: number }[] = [];
  for (const t of traces) {
    const sender = senderByTx.get(t.transaction_hash);
    if (!sender) continue;
    const position = Number(t.transaction_position);
    if (t.function_name === "mint") {
      const parsed = parseMintParams(t.inputs);
      if (parsed) mints.push({ ...parsed, sender, txHash: t.transaction_hash, position });
    } else {
      decreases.push({ sender, txHash: t.transaction_hash, position });
    }
  }
  if (mints.length === 0 || decreases.length === 0) return [];

  const { rows: swapRows } = await pool.query(
    `SELECT transaction_position, from_address, token_in_address, token_out_address
     FROM swaps WHERE block_number = $1`,
    [blockNumber],
  );
  const swaps = swapRows.map((s) => ({
    position: Number(s.transaction_position),
    fromAddress: s.from_address as string,
    tokenIn: (s.token_in_address as string | null)?.toLowerCase(),
    tokenOut: (s.token_out_address as string | null)?.toLowerCase(),
  }));

  const results: JitLiquidityEvent[] = [];
  for (const mint of mints) {
    const candidateDecreases = decreases.filter(
      (d) => d.sender === mint.sender && d.position > mint.position && d.txHash !== mint.txHash,
    );

    for (const decrease of candidateDecreases) {
      const between = swaps.filter(
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

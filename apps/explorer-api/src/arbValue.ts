// ADR-014: value an arbitrage by the ETH-priced sum of its net token delta
// across EVERY token it touches, not just the single stored profit token.
// Valuation-only — reads the detector's output (arbitrage_swaps route + swaps)
// and prices it (onchainPrices.ts); no detector or schema change.
import { pool } from "@mev/db";
import {
  type PriceMethod,
  type SwapRateInput,
  type TokenPrice,
  buildEthPriceGraph,
  loadDecimals,
  priceTokensToEth,
} from "./onchainPrices.js";

export interface ArbDelta {
  arbitrageId: string;
  transactionHash: string;
  blockNumber: number;
  /** token (lowercase) → net delta in raw units (bigint); credited − debited */
  deltas: Map<string, bigint>;
}

export interface ArbBreakdownItem {
  token: string;
  symbol: string;
  delta: number; // decimals-adjusted token units (signed)
  ethPrice: number | null;
  ethValue: number; // delta × ethPrice, 0 when unpriced
  method: PriceMethod;
}

export interface ArbValuation {
  arbitrageId: string;
  transactionHash: string;
  ethValue: number; // sum of priced token ethValues
  breakdown: ArbBreakdownItem[];
  unpricedTokens: string[]; // tokens with a non-dust delta but no price
}

// A token delta below this share of the arbitrage's largest delta is treated as
// a pass-through residual of an intermediate hop, not realized profit, and
// dropped so chaining noise doesn't inflate the figure. The comparison is by
// ETH *value* (not raw units) — a token's units are not comparable across
// tokens with different decimals or prices (0.05 WETH ≫ 1200 USDC in raw units
// yet is worth less), so a unit-based dust test wrongly drops meaningful legs.
const DUST_RELATIVE = 1e-4;

/** Tokens with a non-zero net delta (raw units), lowercased. */
function nonZeroTokens(deltas: Map<string, bigint>): string[] {
  const out: string[] = [];
  for (const [token, d] of deltas) if (d !== 0n) out.push(token);
  return out;
}

/**
 * Net token delta per arbitrage in a block, from its exact route swaps
 * (`arbitrage_swaps` → `swaps`). The searcher debits `token_in` and credits
 * `token_out` on each route swap; summed per token, a clean cycle leaves one
 * non-zero token (the classic profit token) and a multi-token arb leaves
 * several.
 */
export async function getArbitrageDeltas(blockNumber: number): Promise<ArbDelta[]> {
  const { rows } = await pool.query(
    `SELECT a.id AS arbitrage_id, a.transaction_hash, a.block_number,
            s.token_in_address, s.token_in_amount,
            s.token_out_address, s.token_out_amount
     FROM arbitrages a
     JOIN arbitrage_swaps asw ON asw.arbitrage_id = a.id
     JOIN swaps s ON s.transaction_hash = asw.swap_transaction_hash
                 AND s.trace_address = asw.swap_trace_address
     WHERE a.block_number = $1`,
    [blockNumber],
  );

  const byArb = new Map<string, ArbDelta>();
  const add = (deltas: Map<string, bigint>, token: string | null, amount: bigint) => {
    if (!token) return;
    const key = token.toLowerCase();
    deltas.set(key, (deltas.get(key) ?? 0n) + amount);
  };
  for (const r of rows) {
    let arb = byArb.get(r.arbitrage_id);
    if (!arb) {
      arb = {
        arbitrageId: r.arbitrage_id,
        transactionHash: r.transaction_hash,
        blockNumber: Number(r.block_number),
        deltas: new Map(),
      };
      byArb.set(r.arbitrage_id, arb);
    }
    try {
      if (r.token_out_amount) add(arb.deltas, r.token_out_address, BigInt(r.token_out_amount));
      if (r.token_in_amount) add(arb.deltas, r.token_in_address, -BigInt(r.token_in_amount));
    } catch {
      // non-integer amount — skip this leg rather than fail the block
    }
  }
  return [...byArb.values()];
}

/**
 * Value every arbitrage in a block: net delta → ETH-priced sum, with a per-token
 * breakdown carrying the pricing method (ADR-014 §2/§4). One on-chain price
 * graph is built per block and reused across its arbitrages. Every non-zero
 * delta token is priced; value-based dust filtering happens in `valueArb` once
 * prices are known (unit magnitudes are not comparable across tokens).
 */
export async function valueBlockArbitrages(
  blockNumber: number,
  options: { allowFeed?: boolean } = {},
): Promise<Map<string, ArbValuation>> {
  const arbs = await getArbitrageDeltas(blockNumber);
  const result = new Map<string, ArbValuation>();
  if (arbs.length === 0) return result;

  const tokens = new Set<string>();
  for (const arb of arbs) {
    for (const token of nonZeroTokens(arb.deltas)) tokens.add(token);
  }
  const [prices, decimals] = await Promise.all([
    priceTokensToEth(blockNumber, [...tokens], { allowFeed: options.allowFeed }),
    loadDecimals([...tokens]),
  ]);

  for (const arb of arbs) {
    result.set(arb.arbitrageId, valueArb(arb, prices, decimals));
  }
  return result;
}

/**
 * Timeline path (ADR-014 §4): the ETH-priced arbitrage value per block over a
 * range, computed with two bulk queries (route deltas + the arb-blocks' swaps)
 * and one on-chain price graph per block reused across its arbs. On-chain only
 * (allowFeed=false) — the aggregate stays block-exact and makes no external
 * calls across a wide range.
 */
export async function valueArbitragesInRange(
  from: number,
  to: number,
): Promise<Map<number, number>> {
  const { rows: deltaRows } = await pool.query(
    `SELECT a.id AS arbitrage_id, a.block_number, a.transaction_hash,
            s.token_in_address, s.token_in_amount,
            s.token_out_address, s.token_out_amount
     FROM arbitrages a
     JOIN arbitrage_swaps asw ON asw.arbitrage_id = a.id
     JOIN swaps s ON s.transaction_hash = asw.swap_transaction_hash
                 AND s.trace_address = asw.swap_trace_address
     WHERE a.block_number BETWEEN $1 AND $2`,
    [from, to],
  );
  if (deltaRows.length === 0) return new Map();

  const byArb = new Map<string, ArbDelta>();
  const arbsByBlock = new Map<number, ArbDelta[]>();
  const add = (deltas: Map<string, bigint>, token: string | null, amount: bigint) => {
    if (!token) return;
    const key = token.toLowerCase();
    deltas.set(key, (deltas.get(key) ?? 0n) + amount);
  };
  for (const r of deltaRows) {
    let arb = byArb.get(r.arbitrage_id);
    if (!arb) {
      const block = Number(r.block_number);
      arb = {
        arbitrageId: r.arbitrage_id,
        transactionHash: r.transaction_hash,
        blockNumber: block,
        deltas: new Map(),
      };
      byArb.set(r.arbitrage_id, arb);
      const list = arbsByBlock.get(block);
      if (list) list.push(arb);
      else arbsByBlock.set(block, [arb]);
    }
    try {
      if (r.token_out_amount) add(arb.deltas, r.token_out_address, BigInt(r.token_out_amount));
      if (r.token_in_amount) add(arb.deltas, r.token_in_address, -BigInt(r.token_in_amount));
    } catch {
      // skip a non-integer leg
    }
  }

  const blocks = [...arbsByBlock.keys()];
  const { rows: swapRows } = await pool.query(
    `SELECT block_number, token_in_address, token_in_amount,
            token_out_address, token_out_amount
     FROM swaps WHERE block_number = ANY($1) AND error IS NULL`,
    [blocks],
  );
  const swapsByBlock = new Map<number, SwapRateInput[]>();
  const tokens = new Set<string>();
  for (const r of swapRows) {
    const block = Number(r.block_number);
    const list = swapsByBlock.get(block);
    const swap: SwapRateInput = {
      tokenInAddress: r.token_in_address,
      tokenInAmountRaw: r.token_in_amount,
      tokenOutAddress: r.token_out_address,
      tokenOutAmountRaw: r.token_out_amount,
    };
    if (list) list.push(swap);
    else swapsByBlock.set(block, [swap]);
    if (r.token_in_address) tokens.add(r.token_in_address.toLowerCase());
    if (r.token_out_address) tokens.add(r.token_out_address.toLowerCase());
  }
  for (const arb of byArb.values()) {
    for (const token of arb.deltas.keys()) tokens.add(token);
  }
  const decimals = await loadDecimals([...tokens]);

  const ethByBlock = new Map<number, number>();
  for (const [block, arbs] of arbsByBlock) {
    const graph = buildEthPriceGraph(swapsByBlock.get(block) ?? [], (t) => decimals.get(t) ?? 18);
    for (const arb of arbs) {
      const prices = await priceTokensToEth(block, nonZeroTokens(arb.deltas), {
        allowFeed: false,
        onchain: graph,
      });
      const { ethValue } = valueArb(arb, prices, decimals);
      ethByBlock.set(block, (ethByBlock.get(block) ?? 0) + ethValue);
    }
  }
  return ethByBlock;
}

/** Pure valuation of one arb given prices + decimals (unit-testable). */
export function valueArb(
  arb: ArbDelta,
  prices: Map<string, TokenPrice>,
  decimals: Map<string, number>,
): ArbValuation {
  // Decimal-adjusted delta + ETH value for every non-zero token, so dust can be
  // judged by value (priced legs) or, failing a price, by unit share.
  interface Item {
    token: string;
    delta: number;
    price: TokenPrice;
    value: number;
  }
  const items: Item[] = [];
  for (const token of nonZeroTokens(arb.deltas)) {
    const raw = arb.deltas.get(token) ?? 0n;
    const dec = decimals.get(token) ?? 18;
    const delta = Number(raw) / 10 ** dec;
    const price = prices.get(token) ?? { ethPrice: null, method: "unpriced" as PriceMethod };
    items.push({ token, delta, price, value: price.ethPrice != null ? delta * price.ethPrice : 0 });
  }

  // Dust baselines: the largest priced |value| (the arb's real profit scale) and
  // the largest |delta| in units (fallback for unpriced legs).
  let maxAbsValue = 0;
  let maxAbsUnit = 0;
  for (const it of items) {
    if (it.price.ethPrice != null) maxAbsValue = Math.max(maxAbsValue, Math.abs(it.value));
    maxAbsUnit = Math.max(maxAbsUnit, Math.abs(it.delta));
  }

  const breakdown: ArbBreakdownItem[] = [];
  const unpricedTokens: string[] = [];
  let ethValue = 0;
  for (const it of items) {
    if (it.price.method === "unpriced") {
      // No price to value it — drop obvious unit-dust (e.g. 1-wei hop residuals),
      // otherwise flag it so the total is transparently incomplete.
      if (maxAbsUnit > 0 && Math.abs(it.delta) < DUST_RELATIVE * maxAbsUnit) continue;
      unpricedTokens.push(it.token);
      breakdown.push({
        token: it.token,
        symbol: "",
        delta: it.delta,
        ethPrice: null,
        ethValue: 0,
        method: "unpriced",
      });
      continue;
    }
    // Priced: drop legs whose value is a negligible share of the profit scale.
    if (maxAbsValue > 0 && Math.abs(it.value) < DUST_RELATIVE * maxAbsValue) continue;
    ethValue += it.value;
    breakdown.push({
      token: it.token,
      symbol: "", // filled by the caller when it has token info; kept lean here
      delta: it.delta,
      ethPrice: it.price.ethPrice,
      ethValue: it.value,
      method: it.price.method,
    });
  }
  return {
    arbitrageId: arb.arbitrageId,
    transactionHash: arb.transactionHash,
    ethValue,
    breakdown,
    unpricedTokens,
  };
}

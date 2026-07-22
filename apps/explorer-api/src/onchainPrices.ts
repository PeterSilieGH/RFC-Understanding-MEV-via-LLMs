// ADR-014: price tokens into ETH so a multi-token arbitrage delta can be summed
// into one figure. Two sources, recorded per token so the method is
// distinguishable (ADR-014 §2):
//   `onchain` — derived from the SAME block's swap rates, chained to WETH.
//               Block-exact, no external dependency.
//   `feed`    — CoinGecko (token_eur / weth_eur), for tokens with no in-block
//               path to WETH.
//   `unpriced`— neither source yields a price; the token's delta is flagged and
//               excluded, never silently valued at zero.
import { pool } from "@mev/db";
import { WETH_ADDRESS, getEurPrices } from "./eurPrices.js";
import { getTokenInfo } from "./tokens.js";

export type PriceMethod = "onchain" | "feed" | "unpriced";

export interface TokenPrice {
  ethPrice: number | null;
  method: PriceMethod;
}

export interface SwapRateInput {
  tokenInAddress: string | null;
  tokenInAmountRaw: string | null;
  tokenOutAddress: string | null;
  tokenOutAmountRaw: string | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Build a token→ETH price map from a block's swaps. WETH is the numeraire
 * (price 1). Each swap contributes an observed rate between its two tokens
 * (decimals-normalized); multiple observations of a pair are reduced by median.
 * Prices propagate out from WETH by BFS (fewest hops first), so every token
 * with an in-block path to WETH gets a block-exact ETH price. Pure function —
 * the caller supplies decimals so it stays testable and RPC-free.
 */
export function buildEthPriceGraph(
  swaps: SwapRateInput[],
  decimals: (token: string) => number,
): Map<string, number> {
  // rates[X][Y] = list of "units of Y per unit X"
  const rates = new Map<string, Map<string, number[]>>();
  const addRate = (from: string, to: string, rate: number) => {
    if (!Number.isFinite(rate) || rate <= 0) return;
    let row = rates.get(from);
    if (!row) {
      row = new Map();
      rates.set(from, row);
    }
    const list = row.get(to);
    if (list) list.push(rate);
    else row.set(to, [rate]);
  };

  for (const s of swaps) {
    if (!s.tokenInAddress || !s.tokenOutAddress || !s.tokenInAmountRaw || !s.tokenOutAmountRaw) {
      continue;
    }
    const a = s.tokenInAddress.toLowerCase();
    const b = s.tokenOutAddress.toLowerCase();
    if (a === b) continue;
    const inUnits = Number(s.tokenInAmountRaw) / 10 ** decimals(a);
    const outUnits = Number(s.tokenOutAmountRaw) / 10 ** decimals(b);
    if (!(inUnits > 0) || !(outUnits > 0)) continue;
    addRate(a, b, outUnits / inUnits); // B per A
    addRate(b, a, inUnits / outUnits); // A per B
  }

  const price = new Map<string, number>([[WETH_ADDRESS, 1]]);
  const queue: string[] = [WETH_ADDRESS];
  while (queue.length > 0) {
    const known = queue.shift() as string;
    const knownPrice = price.get(known) as number;
    const neighbors = rates.get(known);
    if (!neighbors) continue;
    for (const neighbor of neighbors.keys()) {
      if (price.has(neighbor)) continue;
      // price(neighbor in ETH) = price(known) * (known per neighbor)
      const perKnown = rates.get(neighbor)?.get(known);
      if (!perKnown || perKnown.length === 0) continue;
      const p = knownPrice * median(perKnown);
      if (Number.isFinite(p) && p > 0) {
        price.set(neighbor, p);
        queue.push(neighbor);
      }
    }
  }
  return price;
}

/** Load a block's non-errored swaps and build its on-chain ETH price map. */
export async function getOnchainEthPrices(blockNumber: number): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `SELECT token_in_address, token_in_amount, token_out_address, token_out_amount
     FROM swaps WHERE block_number = $1 AND error IS NULL`,
    [blockNumber],
  );
  const swaps: SwapRateInput[] = rows.map((r) => ({
    tokenInAddress: r.token_in_address,
    tokenInAmountRaw: r.token_in_amount,
    tokenOutAddress: r.token_out_address,
    tokenOutAmountRaw: r.token_out_amount,
  }));
  const tokens = new Set<string>();
  for (const s of swaps) {
    if (s.tokenInAddress) tokens.add(s.tokenInAddress.toLowerCase());
    if (s.tokenOutAddress) tokens.add(s.tokenOutAddress.toLowerCase());
  }
  const decimals = await loadDecimals([...tokens]);
  return buildEthPriceGraph(swaps, (t) => decimals.get(t) ?? 18);
}

/** Batch decimals lookups (cached in tokens.ts; known tokens are instant). */
export async function loadDecimals(tokens: string[]): Promise<Map<string, number>> {
  const infos = await Promise.all(tokens.map((t) => getTokenInfo(t)));
  return new Map(tokens.map((t, i) => [t.toLowerCase(), infos[i].decimals]));
}

/**
 * Price a set of tokens into ETH for one block, recording the method per token.
 * On-chain first; when `allowFeed` (default true) the CoinGecko EUR feed fills
 * gaps via token_eur / weth_eur; otherwise unmatched tokens are `unpriced`.
 * The timeline passes allowFeed=false (block-exact, no external calls across a
 * range); the per-tx view passes true for best coverage.
 */
export async function priceTokensToEth(
  blockNumber: number,
  tokens: string[],
  options: { allowFeed?: boolean; onchain?: Map<string, number> } = {},
): Promise<Map<string, TokenPrice>> {
  const allowFeed = options.allowFeed ?? true;
  const onchain = options.onchain ?? (await getOnchainEthPrices(blockNumber));
  const out = new Map<string, TokenPrice>();
  const needFeed: string[] = [];
  for (const raw of tokens) {
    const token = raw.toLowerCase();
    if (out.has(token)) continue;
    const oc = onchain.get(token);
    if (oc !== undefined) out.set(token, { ethPrice: oc, method: "onchain" });
    else needFeed.push(token);
  }
  if (needFeed.length > 0 && allowFeed) {
    const eur = await getEurPrices([...needFeed, WETH_ADDRESS]);
    const wethEur = eur[WETH_ADDRESS];
    for (const token of needFeed) {
      const tokenEur = eur[token];
      if (tokenEur != null && wethEur != null && wethEur > 0) {
        out.set(token, { ethPrice: tokenEur / wethEur, method: "feed" });
      } else {
        out.set(token, { ethPrice: null, method: "unpriced" });
      }
    }
  } else {
    for (const token of needFeed) out.set(token, { ethPrice: null, method: "unpriced" });
  }
  return out;
}

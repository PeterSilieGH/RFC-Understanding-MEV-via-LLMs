import { pool } from "@mev/db";
import { getEurPrices } from "./eurPrices.js";
import { type FormattedAmount, formatAmount, getTokenInfo } from "./tokens.js";

export interface ActivityItem {
  type: string;
  blockNumber: number;
  transactionHash: string;
  profit?: FormattedAmount | null;
  payment?: FormattedAmount | null;
  protocols?: string[] | null;
  protocol?: string | null;
  error?: string | null;
  role?: "buyer" | "seller";
}

export async function getAddressActivity(address: string): Promise<ActivityItem[]> {
  const addr = address.toLowerCase();

  const [arb, sandwich, liqAsLiquidator, liqAsVictim, nft] = await Promise.all([
    pool.query(
      `SELECT block_number, transaction_hash, profit_token_address, profit_amount, protocols, error
       FROM arbitrages WHERE LOWER(account_address) = $1
       ORDER BY block_number DESC LIMIT 100`,
      [addr],
    ),
    pool.query(
      `SELECT block_number, frontrun_swap_transaction_hash AS transaction_hash,
              profit_token_address, profit_amount
       FROM sandwiches WHERE LOWER(sandwicher_address) = $1
       ORDER BY block_number DESC LIMIT 100`,
      [addr],
    ),
    pool.query(
      `SELECT block_number, transaction_hash, received_token_address, received_amount, protocol, error
       FROM liquidations WHERE LOWER(liquidator_user) = $1
       ORDER BY block_number DESC LIMIT 100`,
      [addr],
    ),
    pool.query(
      `SELECT block_number, transaction_hash, protocol
       FROM liquidations WHERE LOWER(liquidated_user) = $1
       ORDER BY block_number DESC LIMIT 100`,
      [addr],
    ),
    pool.query(
      `SELECT block_number, transaction_hash, payment_token_address, payment_amount,
              protocol, buyer_address, seller_address
       FROM nft_trades WHERE LOWER(buyer_address) = $1 OR LOWER(seller_address) = $1
       ORDER BY block_number DESC LIMIT 100`,
      [addr],
    ),
  ]);

  const items: ActivityItem[] = [];

  for (const row of arb.rows) {
    items.push({
      type: "arbitrage",
      blockNumber: Number(row.block_number),
      transactionHash: row.transaction_hash,
      profit: await formatAmount(row.profit_amount, row.profit_token_address),
      protocols: row.protocols,
      error: row.error,
    });
  }
  for (const row of sandwich.rows) {
    items.push({
      type: "sandwich",
      blockNumber: Number(row.block_number),
      transactionHash: row.transaction_hash,
      profit: await formatAmount(row.profit_amount, row.profit_token_address),
    });
  }
  for (const row of liqAsLiquidator.rows) {
    items.push({
      type: "liquidation_performed",
      blockNumber: Number(row.block_number),
      transactionHash: row.transaction_hash,
      profit: await formatAmount(row.received_amount, row.received_token_address),
      protocol: row.protocol,
      error: row.error,
    });
  }
  for (const row of liqAsVictim.rows) {
    items.push({
      type: "liquidation_suffered",
      blockNumber: Number(row.block_number),
      transactionHash: row.transaction_hash,
      protocol: row.protocol,
    });
  }
  for (const row of nft.rows) {
    items.push({
      type: "nft_trade",
      blockNumber: Number(row.block_number),
      transactionHash: row.transaction_hash,
      payment: await formatAmount(row.payment_amount, row.payment_token_address),
      protocol: row.protocol,
      role: row.buyer_address?.toLowerCase() === addr ? "buyer" : "seller",
    });
  }

  items.sort((a, b) => b.blockNumber - a.blockNumber);
  return items.slice(0, 100);
}

interface CountEntry {
  address: string;
  count: number;
}

export async function getLeaderboard(): Promise<{
  arbitrageurs: CountEntry[];
  sandwichers: CountEntry[];
  liquidators: CountEntry[];
}> {
  const [arbitrageurs, sandwichers, liquidators] = await Promise.all([
    pool.query(
      `SELECT account_address AS address, COUNT(*) AS cnt
       FROM arbitrages WHERE error IS NULL
       GROUP BY account_address ORDER BY cnt DESC LIMIT 10`,
    ),
    pool.query(
      `SELECT sandwicher_address AS address, COUNT(*) AS cnt
       FROM sandwiches
       GROUP BY sandwicher_address ORDER BY cnt DESC LIMIT 10`,
    ),
    pool.query(
      `SELECT liquidator_user AS address, COUNT(*) AS cnt
       FROM liquidations WHERE error IS NULL
       GROUP BY liquidator_user ORDER BY cnt DESC LIMIT 10`,
    ),
  ]);

  const toList = (rows: { address: string; cnt: string }[]): CountEntry[] =>
    rows.map((r) => ({ address: r.address, count: Number(r.cnt) }));

  return {
    arbitrageurs: toList(arbitrageurs.rows),
    sandwichers: toList(sandwichers.rows),
    liquidators: toList(liquidators.rows),
  };
}

export interface Searcher {
  address: string;
  arbitrage: number;
  sandwich: number;
  liquidation: number;
  total: number;
  profitEur?: number | null;
}

export async function getTopSearchers(limit = 15): Promise<Searcher[]> {
  const [arb, sandwich, liq] = await Promise.all([
    pool.query(
      `SELECT account_address AS address, COUNT(*) AS cnt
       FROM arbitrages WHERE error IS NULL GROUP BY account_address`,
    ),
    pool.query(
      `SELECT sandwicher_address AS address, COUNT(*) AS cnt
       FROM sandwiches GROUP BY sandwicher_address`,
    ),
    pool.query(
      `SELECT liquidator_user AS address, COUNT(*) AS cnt
       FROM liquidations WHERE error IS NULL GROUP BY liquidator_user`,
    ),
  ]);

  const byAddress = new Map<string, Searcher>();
  function add(
    rows: { address: string | null; cnt: string }[],
    key: "arbitrage" | "sandwich" | "liquidation",
  ): void {
    for (const row of rows) {
      if (!row.address) continue;
      if (!byAddress.has(row.address)) {
        byAddress.set(row.address, {
          address: row.address,
          arbitrage: 0,
          sandwich: 0,
          liquidation: 0,
          total: 0,
        });
      }
      const entry = byAddress.get(row.address)!;
      entry[key] = Number(row.cnt);
      entry.total += Number(row.cnt);
    }
  }
  add(arb.rows, "arbitrage");
  add(sandwich.rows, "sandwich");
  add(liq.rows, "liquidation");

  const searchers = [...byAddress.values()];
  await attachProfitEur(searchers);

  return searchers.sort((a, b) => (b.profitEur ?? -1) - (a.profitEur ?? -1)).slice(0, limit);
}

// Sums each address's profit per token (raw units, across arbitrage,
// sandwich, and liquidation rewards), then converts to EUR using the same
// price feed as the EUR display toggle, so searchers can be ranked by
// actual profit instead of just action count - not possible before that
// feed existed, since profits land in whatever token the strategy traded.
async function attachProfitEur(searchers: Searcher[]): Promise<void> {
  if (searchers.length === 0) return;
  const addresses = searchers.map((s) => s.address.toLowerCase());

  const [arbProfits, sandwichProfits, liqProfits] = await Promise.all([
    pool.query(
      `SELECT account_address AS address, profit_token_address AS token, SUM(profit_amount) AS total
       FROM arbitrages WHERE error IS NULL AND LOWER(account_address) = ANY($1)
       GROUP BY account_address, profit_token_address`,
      [addresses],
    ),
    pool.query(
      `SELECT sandwicher_address AS address, profit_token_address AS token, SUM(profit_amount) AS total
       FROM sandwiches WHERE LOWER(sandwicher_address) = ANY($1)
       GROUP BY sandwicher_address, profit_token_address`,
      [addresses],
    ),
    pool.query(
      `SELECT liquidator_user AS address, received_token_address AS token, SUM(received_amount) AS total
       FROM liquidations WHERE error IS NULL AND LOWER(liquidator_user) = ANY($1)
       GROUP BY liquidator_user, received_token_address`,
      [addresses],
    ),
  ]);

  // address -> token -> raw amount (BigInt)
  const byAddressToken = new Map<string, Map<string, bigint>>();
  function addProfit(
    rows: { address: string | null; token: string | null; total: string }[],
  ): void {
    for (const row of rows) {
      if (!row.address || !row.token) continue;
      if (!byAddressToken.has(row.address)) byAddressToken.set(row.address, new Map());
      const tokenMap = byAddressToken.get(row.address)!;
      const prev = tokenMap.get(row.token) || 0n;
      let amount: bigint;
      try {
        amount = BigInt(row.total);
      } catch {
        continue;
      }
      tokenMap.set(row.token, prev + amount);
    }
  }
  addProfit(arbProfits.rows);
  addProfit(sandwichProfits.rows);
  addProfit(liqProfits.rows);

  const allTokens = new Set<string>();
  for (const tokenMap of byAddressToken.values()) {
    for (const token of tokenMap.keys()) allTokens.add(token);
  }
  if (allTokens.size === 0) {
    for (const s of searchers) s.profitEur = null;
    return;
  }

  const [eurPrices, tokenInfos] = await Promise.all([
    getEurPrices([...allTokens]),
    Promise.all([...allTokens].map((t) => getTokenInfo(t))),
  ]);
  const decimalsByToken = new Map([...allTokens].map((t, i) => [t, tokenInfos[i].decimals]));

  for (const searcher of searchers) {
    const tokenMap = byAddressToken.get(searcher.address);
    if (!tokenMap) {
      searcher.profitEur = null;
      continue;
    }
    let total = 0;
    let hasPrice = false;
    for (const [token, rawAmount] of tokenMap) {
      const price = eurPrices[token.toLowerCase()];
      if (price == null) continue;
      hasPrice = true;
      const decimals = decimalsByToken.get(token) ?? 18;
      total += (Number(rawAmount) / 10 ** decimals) * price;
    }
    searcher.profitEur = hasPrice ? total : null;
  }
}

export interface PoolHeatmapEntry {
  address: string;
  count: number;
  pair: { tokenA: string; tokenB: string; protocol: string | null } | null;
}

export async function getPoolHeatmap(): Promise<PoolHeatmapEntry[]> {
  const { rows } = await pool.query(
    `SELECT s.contract_address AS address, COUNT(*) AS cnt
     FROM sandwiches sw
     JOIN swaps s
       ON s.block_number = sw.block_number
      AND s.transaction_hash = sw.frontrun_swap_transaction_hash
      AND s.trace_address = sw.frontrun_swap_trace_address
     GROUP BY s.contract_address
     ORDER BY cnt DESC
     LIMIT 10`,
  );

  const pools = await Promise.all(
    rows.map(async (row) => {
      const sample = await pool.query(
        `SELECT token_in_address, token_out_address, protocol
         FROM swaps WHERE contract_address = $1 LIMIT 1`,
        [row.address],
      );
      let label: PoolHeatmapEntry["pair"] = null;
      if (sample.rows.length > 0) {
        const { token_in_address, token_out_address, protocol } = sample.rows[0];
        const [a, b] = await Promise.all([
          getTokenInfo(token_in_address),
          getTokenInfo(token_out_address),
        ]);
        label = { tokenA: a.symbol, tokenB: b.symbol, protocol };
      }
      return { address: row.address, count: Number(row.cnt), pair: label };
    }),
  );

  return pools;
}

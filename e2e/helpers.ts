import { execSync } from "node:child_process";

export const EXPLORER_WEB = `http://localhost:${process.env.EXPLORER_WEB_PORT || 8080}`;
export const EXPLORER_API = `http://localhost:${process.env.EXPLORER_API_PORT || 3000}`;
export const TRACE_API = `http://localhost:${process.env.TRACE_API_PORT || 2022}`;

export const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

function psql(query: string): string | null {
  try {
    const out = execSync(
      `docker compose exec -T postgres psql -U postgres -d mev_inspect -tAc "${query}"`,
      { encoding: "utf8" },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Highest block already inspected into the shared postgres, or null. */
export function latestInspectedBlock(): number | null {
  const out = psql("SELECT block_number FROM blocks ORDER BY block_number DESC LIMIT 1");
  return out ? Number(out) : null;
}

/** An inspected transaction that contains at least one decoded swap, or null. */
export function anySwapTxHash(): string | null {
  return psql("SELECT transaction_hash FROM swaps ORDER BY block_number DESC LIMIT 1");
}

/** An address that has performed at least one arbitrage, or null. */
export function anyArbitrageurAddress(): string | null {
  return psql("SELECT account_address FROM arbitrages ORDER BY block_number DESC LIMIT 1");
}

/** A block containing at least one arbitrage, or null. */
export function anyArbitrageBlock(): number | null {
  const out = psql("SELECT block_number FROM arbitrages ORDER BY block_number DESC LIMIT 1");
  return out ? Number(out) : null;
}

/**
 * A block with an arbitrage whose route nets a non-zero delta in >= 2 distinct
 * tokens — the ADR-014 multi-token case the single-token detector under-counts.
 * (A token may still be value-dust-dropped at valuation time, so the rendered
 * breakdown can be shorter; this only guarantees the raw multi-token shape.)
 */
export function multiTokenArbitrageBlocks(limit = 25): number[] {
  const out = psql(
    `WITH d AS (SELECT a.id, a.block_number, tok, SUM(amt) AS net
     FROM arbitrages a
     JOIN arbitrage_swaps asw ON asw.arbitrage_id = a.id
     JOIN swaps s ON s.transaction_hash = asw.swap_transaction_hash AND s.trace_address = asw.swap_trace_address
     CROSS JOIN LATERAL (VALUES (lower(s.token_out_address), s.token_out_amount::numeric),
       (lower(s.token_in_address), -s.token_in_amount::numeric)) v(tok, amt)
     WHERE a.error IS NULL GROUP BY a.id, a.block_number, tok)
     SELECT DISTINCT block_number FROM (SELECT id, block_number,
       count(*) FILTER (WHERE abs(net) > 0) AS n FROM d GROUP BY id, block_number) q
     WHERE n >= 2 ORDER BY block_number DESC LIMIT ${limit}`,
  );
  return out ? out.split("\n").map(Number) : [];
}

/** The most recent block with a >= 2-token-delta arbitrage, or null. */
export function anyMultiTokenArbitrageBlock(): number | null {
  return multiTokenArbitrageBlocks(1)[0] ?? null;
}

/** An inspected arbitrage transaction that paid a non-zero builder tip
 * (coinbase transfer), so its incident economics are interesting, or null. */
export function anyArbitrageTxWithTip(): string | null {
  return psql(
    "SELECT a.transaction_hash FROM arbitrages a JOIN miner_payments m ON m.transaction_hash = a.transaction_hash WHERE m.coinbase_transfer > 0 ORDER BY m.coinbase_transfer DESC LIMIT 1",
  );
}

/** A block containing at least one sandwich (a multi-tx incident), or null. */
export function anySandwichBlock(): number | null {
  const out = psql("SELECT block_number FROM sandwiches ORDER BY block_number DESC LIMIT 1");
  return out ? Number(out) : null;
}

/** The front-run leg of an inspected sandwich, or null. */
export function anySandwichFrontrunTxHash(): string | null {
  return psql(
    "SELECT frontrun_swap_transaction_hash FROM sandwiches ORDER BY block_number DESC LIMIT 1",
  );
}

/**
 * A transaction hash from the latest block, via the external RPC node
 * (through explorer-api), or null when the node is unreachable.
 */
export async function anyRecentTxHash(): Promise<string | null> {
  try {
    const latest = await fetch(`${EXPLORER_API}/api/latest`);
    if (!latest.ok) return null;
    const { blockNumber } = (await latest.json()) as { blockNumber: number };
    const rpcUrl = process.env.RPC_URL || "http://localhost:8545";
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: [`0x${blockNumber.toString(16)}`, false],
        id: 1,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { transactions?: string[] } };
    return body.result?.transactions?.[0] ?? null;
  } catch {
    return null;
  }
}

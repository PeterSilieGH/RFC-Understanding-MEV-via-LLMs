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

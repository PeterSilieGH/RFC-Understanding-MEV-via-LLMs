import { ensureAppTables, pool } from "@mev/db";

// MEV-Boost relays expose a standardized "data API" (relay-specs).
// builder_blocks_received returns every bid a relay received for a given
// block_hash (one relay may have seen several submissions, e.g. resubmits
// with a higher value); the one that actually became this block is the
// highest of those. A block is only known to the relay(s) the winning
// builder submitted to, so we query all of them and merge.
const RELAYS = [
  "https://aestus.live",
  "https://agnostic-relay.net",
  "https://bloxroute.max-profit.blxrbdn.com",
  "https://bloxroute.regulated.blxrbdn.com",
  "https://boost-relay.flashbots.net",
  "https://titanrelay.xyz",
  "https://relay-analytics.ultrasound.money",
  "https://relay.ethgas.com",
];

const RELAY_TIMEOUT_MS = 4000;

export interface BuilderBid {
  valueWei: string;
  relay: string;
}

interface BidTrace {
  value: string;
}

async function queryRelay(relayBase: string, blockHash: string): Promise<BuilderBid | null> {
  const url = `${relayBase}/relay/v1/data/bidtraces/builder_blocks_received?block_hash=${blockHash}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const rows = (await res.json()) as BidTrace[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    // a relay can list several bid submissions for the same block_hash
    // (resubmits) - the one that won is the highest value among them
    const best = rows.reduce((max, r) => (BigInt(r.value) > BigInt(max.value) ? r : max));
    return { valueWei: best.value, relay: relayBase };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBidFromRelays(blockHash: string): Promise<BuilderBid | null> {
  const results = (await Promise.all(RELAYS.map((r) => queryRelay(r, blockHash)))).filter(
    (r): r is BuilderBid => r !== null,
  );
  if (results.length === 0) return null;
  return results.reduce((max, r) => (BigInt(r.valueWei) > BigInt(max.valueWei) ? r : max));
}

export async function getBuilderBid(
  blockNumber: number,
  blockHash: string | null,
): Promise<BuilderBid | null> {
  await ensureAppTables();

  const cached = await pool.query(
    "SELECT value_wei, relay FROM block_bids WHERE block_number = $1",
    [blockNumber],
  );
  if ((cached.rowCount ?? 0) > 0) {
    const row = cached.rows[0];
    return row.value_wei ? { valueWei: row.value_wei, relay: row.relay } : null;
  }

  if (!blockHash) return null;

  const result = await fetchBidFromRelays(blockHash);
  await pool.query(
    `INSERT INTO block_bids (block_number, value_wei, relay) VALUES ($1, $2, $3)
     ON CONFLICT (block_number) DO UPDATE SET value_wei = EXCLUDED.value_wei, relay = EXCLUDED.relay`,
    [blockNumber, result?.valueWei || null, result?.relay || null],
  );
  return result;
}

export async function getRelayStats(): Promise<{ relay: string; count: number }[]> {
  await ensureAppTables();
  const { rows } = await pool.query(
    "SELECT relay, COUNT(*) AS cnt FROM block_bids WHERE relay IS NOT NULL GROUP BY relay ORDER BY cnt DESC",
  );
  return rows.map((r) => ({ relay: r.relay.replace(/^https?:\/\//, ""), count: Number(r.cnt) }));
}

import { loadConfig } from "@mev/config";
import { ensureAppTables, pool } from "@mev/db";
import { ethers } from "ethers";

const config = loadConfig();
const provider = new ethers.JsonRpcProvider(config.RPC_URL);

export interface BlockBuilder {
  builder: string | null;
  feeRecipient: string | null;
  blockHash: string | null;
}

export function decodeExtraData(extraData: string | null | undefined): string | null {
  if (!extraData || extraData === "0x") return null;
  try {
    const decoded = ethers.toUtf8String(extraData);
    // strip control/non-printable characters some builders pad with
    const cleaned = decoded.replace(/[^\x20-\x7E✀-➿☀-⛿]/g, "").trim();
    return cleaned || null;
  } catch {
    return null;
  }
}

// BuilderNet is a shared network with several operators (Flashbots,
// Nethermind, ...) that all tag blocks as "BuilderNet (<operator>)" - treat
// them as one party rather than splitting share across operators.
function normalizeBuilderName(builder: string | null): string {
  if (!builder) return "(no graffiti)";
  if (builder.startsWith("BuilderNet")) return "BuilderNet";
  return builder;
}

async function fetchAndCacheBuilder(blockNumber: number): Promise<BlockBuilder> {
  const block = await provider.getBlock(blockNumber);
  const builder = block ? decodeExtraData(block.extraData) : null;
  const feeRecipient = block ? block.miner : null;
  const blockHash = block ? block.hash : null;
  await ensureAppTables();
  await pool.query(
    `INSERT INTO block_builders (block_number, builder, fee_recipient, block_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (block_number) DO UPDATE
       SET builder = EXCLUDED.builder, fee_recipient = EXCLUDED.fee_recipient, block_hash = EXCLUDED.block_hash`,
    [blockNumber, builder, feeRecipient, blockHash],
  );
  return { builder, feeRecipient, blockHash };
}

export async function getBlockBuilder(blockNumber: number): Promise<BlockBuilder> {
  await ensureAppTables();
  const cached = await pool.query(
    "SELECT builder, fee_recipient, block_hash FROM block_builders WHERE block_number = $1",
    [blockNumber],
  );
  if ((cached.rowCount ?? 0) > 0 && cached.rows[0].block_hash) {
    return {
      builder: cached.rows[0].builder,
      feeRecipient: cached.rows[0].fee_recipient,
      blockHash: cached.rows[0].block_hash,
    };
  }
  try {
    return await fetchAndCacheBuilder(blockNumber);
  } catch {
    return { builder: null, feeRecipient: null, blockHash: null };
  }
}

async function ensureBuildersCached(blockNumbers: number[]): Promise<void> {
  await ensureAppTables();
  const { rows: cachedRows } = await pool.query("SELECT block_number FROM block_builders");
  const cachedSet = new Set(cachedRows.map((r) => Number(r.block_number)));
  const missing = blockNumbers.filter((bn) => !cachedSet.has(bn));

  const concurrency = 20;
  let i = 0;
  async function worker(): Promise<void> {
    while (i < missing.length) {
      const blockNumber = missing[i++];
      await fetchAndCacheBuilder(blockNumber).catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
}

export async function getBuilderStats(): Promise<{ builder: string; count: number }[]> {
  await ensureAppTables();

  const { rows: blockRows } = await pool.query("SELECT block_number FROM blocks");
  const allBlockNumbers = blockRows.map((r) => Number(r.block_number));
  await ensureBuildersCached(allBlockNumbers);

  const { rows } = await pool.query(
    `SELECT builder, COUNT(*) AS cnt
     FROM block_builders
     WHERE block_number = ANY($1)
     GROUP BY builder`,
    [allBlockNumbers],
  );

  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = normalizeBuilderName(row.builder);
    counts.set(name, (counts.get(name) || 0) + Number(row.cnt));
  }

  return [...counts.entries()]
    .map(([builder, count]) => ({ builder, count }))
    .sort((a, b) => b.count - a.count);
}

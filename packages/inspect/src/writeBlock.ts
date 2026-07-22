// Replaces mev-inspect-py's crud/ layer. Persists one block's facts to the
// shared Postgres, reproducing the exact column shapes the explorer reads
// (see docs/design/mev-inspect-audit.md and packages/db schema.ts):
//   - classified_traces.inputs: a one-element JSON array wrapping the named
//     inputs dict, with big integers as unquoted number literals.
//   - classified_traces.protocol: Python `str(enum)` ("Protocol.x" / "None");
//     swaps/arbitrages/liquidations/nft_trades: the enum value ("uniswap_v2", "0x").
//   - liquidations/nft_trades.trace_address: stringified list ("[0, 1]");
//     everything else: integer[].
// Idempotent: each table's rows for the block are deleted before re-insert
// (arbitrage_swaps / sandwiched_swaps cascade from their parents).
import { randomUUID } from "node:crypto";
import { pool } from "@mev/db";
import { PostgresEvidenceStore } from "@mev/evidence";
import type { PoolClient } from "pg";
import type { InspectResult } from "./inspectBlock.js";
import { buildExecutionArtifacts, buildFlowArtifacts } from "./evidence.js";
import { protocolTraceRepr, protocolWireValue } from "./types.js";

const MAX_PARAMS = 60000;

export async function writeBlock(result: InspectResult): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const n = result.blockNumber;

    // delete-by-block (children cascade)
    for (const table of [
      "classified_traces",
      "transfers",
      "swaps",
      "arbitrages",
      "sandwiches",
      "liquidations",
      "nft_trades",
      "miner_payments",
      "mev_jit_liquidity",
      "mev_non_atomic_arbitrages",
      "mev_liquidation_sandwiches",
      "mev_liquidation_races",
      "mev_nft_flips",
    ]) {
      await client.query(`DELETE FROM ${table} WHERE block_number = $1`, [n]);
    }

    await client.query(
      `INSERT INTO blocks (block_number, block_timestamp)
       VALUES ($1, to_timestamp($2) AT TIME ZONE 'UTC')
       ON CONFLICT (block_number) DO UPDATE SET block_timestamp = EXCLUDED.block_timestamp`,
      [n, result.blockTimestamp],
    );

    await writeClassifiedTraces(client, result);
    await writeTransfers(client, result);
    await writeSwaps(client, result);
    await writeArbitrages(client, result);
    await writeSandwiches(client, result);
    await writeLiquidations(client, result);
    await writeNftTrades(client, result);
    await writeMinerPayments(client, result);
    await writeDetectors(client, result);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  // Normalized immutable evidence is written only after the pipeline block
  // transaction commits. Each content-addressed upsert is idempotent, so a
  // partial evidence write remains safely retryable on reinspection.
  const evidence = new PostgresEvidenceStore();
  for (const artifact of buildExecutionArtifacts(result)) {
    await evidence.putExecutionArtifact(artifact);
  }
  for (const artifact of buildFlowArtifacts(result)) {
    await evidence.putFlowArtifact(artifact);
  }
}

// --- helpers ----------------------------------------------------------------

async function insertRows(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  if (rows.length === 0) return;
  const perRow = columns.length;
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / perRow));
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((row, r) => {
      const placeholders = row.map((_, c) => `$${r * perRow + c + 1}`);
      values.push(...row);
      return `(${placeholders.join(",")})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
      values,
    );
  }
}

const num = (v: bigint | null | undefined): string | null => (v == null ? null : v.toString());
/** Python-style stringified int list for the varchar trace_address columns. */
const traceAddrStr = (a: number[]): string => `[${a.join(", ")}]`;

/** `[ { name: value } ]` with bigints as raw (unquoted) JSON number literals. */
function serializeInputs(inputs: Record<string, unknown> | null): string | null {
  if (inputs === null) return null;
  const json = JSON.stringify([inputs], (_key, value) =>
    typeof value === "bigint" ? `__BIGINT__${value}__` : value,
  );
  return json.replace(/"__BIGINT__(-?\d+)__"/g, "$1");
}

// --- per-table writers ------------------------------------------------------

async function writeClassifiedTraces(client: PoolClient, r: InspectResult): Promise<void> {
  const rows = r.classifiedTraces.map((t) => [
    t.transactionHash,
    r.blockNumber,
    t.classification,
    t.type,
    protocolTraceRepr(t.protocol),
    t.abiName,
    t.functionName,
    t.functionSignature,
    serializeInputs(t.inputs),
    t.fromAddress,
    t.toAddress,
    num(t.gas),
    num(t.value),
    num(t.gasUsed),
    t.error,
    t.traceAddress,
    t.transactionPosition,
  ]);
  await insertRows(
    client,
    "classified_traces",
    [
      "transaction_hash",
      "block_number",
      "classification",
      "trace_type",
      "protocol",
      "abi_name",
      "function_name",
      "function_signature",
      "inputs",
      "from_address",
      "to_address",
      "gas",
      "value",
      "gas_used",
      "error",
      "trace_address",
      "transaction_position",
    ],
    rows,
  );
}

async function writeTransfers(client: PoolClient, r: InspectResult): Promise<void> {
  const rows = r.transfers.map((t) => [
    r.blockNumber,
    t.transactionHash,
    t.traceAddress,
    null,
    t.fromAddress,
    t.toAddress,
    t.tokenAddress,
    num(t.amount),
    null,
  ]);
  await insertRows(
    client,
    "transfers",
    [
      "block_number",
      "transaction_hash",
      "trace_address",
      "protocol",
      "from_address",
      "to_address",
      "token_address",
      "amount",
      "error",
    ],
    rows,
  );
}

async function writeSwaps(client: PoolClient, r: InspectResult): Promise<void> {
  const rows = r.swaps.map((s) => [
    s.abiName,
    s.transactionHash,
    r.blockNumber,
    protocolWireValue(s.protocol),
    s.contractAddress,
    s.fromAddress,
    s.toAddress,
    s.tokenInAddress,
    num(s.tokenInAmount),
    s.tokenOutAddress,
    num(s.tokenOutAmount),
    s.traceAddress,
    s.error,
    s.transactionPosition,
  ]);
  await insertRows(
    client,
    "swaps",
    [
      "abi_name",
      "transaction_hash",
      "block_number",
      "protocol",
      "contract_address",
      "from_address",
      "to_address",
      "token_in_address",
      "token_in_amount",
      "token_out_address",
      "token_out_amount",
      "trace_address",
      "error",
      "transaction_position",
    ],
    rows,
  );
}

async function writeArbitrages(client: PoolClient, r: InspectResult): Promise<void> {
  const arbRows: unknown[][] = [];
  const arbSwapRows: unknown[][] = [];
  for (const arb of r.arbitrages) {
    const id = randomUUID();
    const protocols = [...new Set(arb.swaps.map((s) => protocolWireValue(s.protocol)))].filter(
      (p): p is string => p !== null,
    );
    arbRows.push([
      id,
      arb.accountAddress,
      arb.profitTokenAddress,
      arb.blockNumber,
      arb.transactionHash,
      num(arb.startAmount),
      num(arb.endAmount),
      num(arb.profitAmount),
      arb.error,
      protocols,
    ]);
    for (const swap of arb.swaps) {
      arbSwapRows.push([id, swap.transactionHash, swap.traceAddress]);
    }
  }
  await insertRows(
    client,
    "arbitrages",
    [
      "id",
      "account_address",
      "profit_token_address",
      "block_number",
      "transaction_hash",
      "start_amount",
      "end_amount",
      "profit_amount",
      "error",
      "protocols",
    ],
    arbRows,
  );
  await insertRows(
    client,
    "arbitrage_swaps",
    ["arbitrage_id", "swap_transaction_hash", "swap_trace_address"],
    arbSwapRows,
  );
}

async function writeSandwiches(client: PoolClient, r: InspectResult): Promise<void> {
  const sandwichRows: unknown[][] = [];
  const sandwichedRows: unknown[][] = [];
  for (const s of r.sandwiches) {
    const id = randomUUID();
    sandwichRows.push([
      id,
      s.blockNumber,
      s.sandwicherAddress,
      s.frontrunSwap.transactionHash,
      s.frontrunSwap.traceAddress,
      s.backrunSwap.transactionHash,
      s.backrunSwap.traceAddress,
      s.profitTokenAddress,
      num(s.profitAmount),
    ]);
    for (const swap of s.sandwichedSwaps) {
      sandwichedRows.push([id, swap.blockNumber, swap.transactionHash, swap.traceAddress]);
    }
  }
  await insertRows(
    client,
    "sandwiches",
    [
      "id",
      "block_number",
      "sandwicher_address",
      "frontrun_swap_transaction_hash",
      "frontrun_swap_trace_address",
      "backrun_swap_transaction_hash",
      "backrun_swap_trace_address",
      "profit_token_address",
      "profit_amount",
    ],
    sandwichRows,
  );
  await insertRows(
    client,
    "sandwiched_swaps",
    ["sandwich_id", "block_number", "transaction_hash", "trace_address"],
    sandwichedRows,
  );
}

async function writeLiquidations(client: PoolClient, r: InspectResult): Promise<void> {
  const rows = r.liquidations.map((l) => [
    l.liquidatedUser,
    l.liquidatorUser,
    l.debtTokenAddress,
    num(l.debtPurchaseAmount),
    num(l.receivedAmount),
    protocolWireValue(l.protocol),
    l.transactionHash,
    traceAddrStr(l.traceAddress),
    r.blockNumber,
    l.receivedTokenAddress,
    l.error,
  ]);
  await insertRows(
    client,
    "liquidations",
    [
      "liquidated_user",
      "liquidator_user",
      "debt_token_address",
      "debt_purchase_amount",
      "received_amount",
      "protocol",
      "transaction_hash",
      "trace_address",
      "block_number",
      "received_token_address",
      "error",
    ],
    rows,
  );
}

async function writeNftTrades(client: PoolClient, r: InspectResult): Promise<void> {
  const rows = r.nftTrades.map((t) => [
    t.abiName,
    t.transactionHash,
    t.transactionPosition,
    r.blockNumber,
    traceAddrStr(t.traceAddress),
    protocolWireValue(t.protocol),
    t.error,
    t.sellerAddress,
    t.buyerAddress,
    t.paymentTokenAddress,
    num(t.paymentAmount),
    t.collectionAddress,
    num(t.tokenId),
  ]);
  await insertRows(
    client,
    "nft_trades",
    [
      "abi_name",
      "transaction_hash",
      "transaction_position",
      "block_number",
      "trace_address",
      "protocol",
      "error",
      "seller_address",
      "buyer_address",
      "payment_token_address",
      "payment_amount",
      "collection_address",
      "token_id",
    ],
    rows,
  );
}

async function writeDetectors(client: PoolClient, r: InspectResult): Promise<void> {
  const d = r.detectors;
  await insertRows(
    client,
    "mev_jit_liquidity",
    [
      "block_number",
      "sender",
      "mint_tx_hash",
      "decrease_tx_hash",
      "token0",
      "token1",
      "fee",
      "swaps_between",
      "matching_pool_swaps",
    ],
    d.jitLiquidity.map((e) => [
      r.blockNumber,
      e.sender,
      e.mintTxHash,
      e.decreaseTxHash,
      e.token0,
      e.token1,
      num(e.fee),
      e.swapsBetween,
      e.matchingPoolSwaps,
    ]),
  );
  await insertRows(
    client,
    "mev_non_atomic_arbitrages",
    [
      "block_number",
      "address",
      "first_tx_hash",
      "second_tx_hash",
      "token_address",
      "profit_amount",
    ],
    d.nonAtomicArbitrages.map((e) => [
      r.blockNumber,
      e.address,
      e.firstTxHash,
      e.secondTxHash,
      e.tokenAddress,
      num(e.profitAmount),
    ]),
  );
  await insertRows(
    client,
    "mev_liquidation_sandwiches",
    [
      "block_number",
      "liquidator",
      "liquidation_tx_hash",
      "setup_swap_tx_hash",
      "reverse_swap_tx_hash",
    ],
    d.liquidationSandwiches.map((e) => [
      r.blockNumber,
      e.liquidator,
      e.liquidationTxHash,
      e.setupSwapTxHash,
      e.reverseSwapTxHash,
    ]),
  );
  await insertRows(
    client,
    "mev_liquidation_races",
    ["block_number", "borrower", "winner_tx_hash", "winner_address", "loser_tx_hashes"],
    d.liquidationRaces.map((e) => [
      r.blockNumber,
      e.borrower,
      e.winnerTxHash,
      e.winnerAddress,
      e.loserTxHashes,
    ]),
  );
  await insertRows(
    client,
    "mev_nft_flips",
    [
      "block_number",
      "flipper",
      "collection_address",
      "token_id",
      "buy_tx_hash",
      "sell_tx_hash",
      "profit_amount",
      "profit_token_address",
    ],
    d.nftFlips.map((e) => [
      r.blockNumber,
      e.flipper,
      e.collectionAddress,
      num(e.tokenId),
      e.buyTxHash,
      e.sellTxHash,
      num(e.profitAmount),
      e.profitTokenAddress,
    ]),
  );
}

async function writeMinerPayments(client: PoolClient, r: InspectResult): Promise<void> {
  const rows = r.minerPayments.map((m) => [
    r.blockNumber,
    m.transactionHash,
    m.transactionIndex,
    m.minerAddress,
    num(m.coinbaseTransfer),
    num(m.baseFeePerGas),
    num(m.gasPrice),
    num(m.gasPriceWithCoinbaseTransfer),
    num(m.gasUsed),
    m.transactionToAddress,
    m.transactionFromAddress,
  ]);
  await insertRows(
    client,
    "miner_payments",
    [
      "block_number",
      "transaction_hash",
      "transaction_index",
      "miner_address",
      "coinbase_transfer",
      "base_fee_per_gas",
      "gas_price",
      "gas_price_with_coinbase_transfer",
      "gas_used",
      "transaction_to_address",
      "transaction_from_address",
    ],
    rows,
  );
}

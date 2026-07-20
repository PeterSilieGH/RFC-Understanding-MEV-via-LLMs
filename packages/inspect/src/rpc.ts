// Ports mev_inspect/block.py's fetching. Uses the Parity `trace_block` namespace
// (served by reth/Erigon) plus the block header and receipts. Receipts are
// fetched via eth_getBlockReceipts with a per-tx fallback (audit fix B5 — not
// every node serves the batch method).
import type { JsonRpcProvider } from "ethers";
import type { Block, RawTrace, Receipt } from "./types.js";
import { hexToBigInt, hexToNumber } from "./utils.js";

function toHexBlock(blockNumber: number): string {
  return `0x${blockNumber.toString(16)}`;
}

export async function fetchBlock(provider: JsonRpcProvider, blockNumber: number): Promise<Block> {
  const hexBlock = toHexBlock(blockNumber);
  const [header, traces] = await Promise.all([
    provider.send("eth_getBlockByNumber", [hexBlock, true]),
    provider.send("trace_block", [hexBlock]),
  ]);
  if (header === null) throw new Error(`block ${blockNumber} not found`);

  const receipts = await fetchReceipts(provider, hexBlock, header);

  return {
    blockNumber,
    blockTimestamp: hexToNumber(header.timestamp),
    miner: typeof header.miner === "string" ? header.miner.toLowerCase() : "",
    baseFeePerGas: hexToBigInt(header.baseFeePerGas ?? 0),
    traces: (traces as RawTrace[]) ?? [],
    receipts,
  };
}

async function fetchReceipts(
  provider: JsonRpcProvider,
  hexBlock: string,
  header: { transactions?: Array<{ hash: string } | string> },
): Promise<Receipt[]> {
  try {
    const raw = await provider.send("eth_getBlockReceipts", [hexBlock]);
    if (Array.isArray(raw)) return raw.map(parseReceipt);
  } catch {
    // node doesn't support eth_getBlockReceipts — fall back below
  }

  const txHashes = (header.transactions ?? []).map((t) => (typeof t === "string" ? t : t.hash));
  const receipts = await Promise.all(
    txHashes.map((hash) => provider.send("eth_getTransactionReceipt", [hash])),
  );
  return receipts.filter((r): r is NonNullable<typeof r> => r != null).map(parseReceipt);
}

function parseReceipt(r: Record<string, unknown>): Receipt {
  return {
    blockNumber: hexToNumber(r.blockNumber),
    transactionHash: String(r.transactionHash).toLowerCase(),
    transactionIndex: hexToNumber(r.transactionIndex),
    gasUsed: hexToBigInt(r.gasUsed),
    effectiveGasPrice: hexToBigInt(r.effectiveGasPrice ?? 0),
    cumulativeGasUsed: hexToBigInt(r.cumulativeGasUsed ?? 0),
    to: typeof r.to === "string" ? r.to.toLowerCase() : null,
  };
}

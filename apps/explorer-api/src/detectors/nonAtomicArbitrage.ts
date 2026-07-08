import { pool } from "@mev/db";

// "Non-atomic" arbitrage: the same address profits from a round-trip trade
// spread across two separate transactions in the same block, instead of one
// atomic multi-swap transaction. Standard arbitrage classifiers - including
// mev-inspect-py's, which only looks for swap cycles within a single
// transaction - cannot see this at all. Flagged explicitly as an
// under-covered detection gap in MEV literature (Materwala et al. 2024,
// "Maximal Extractable Value in Decentralized Finance: Taxonomy, Detection,
// and Mitigation", arXiv:2411.03327: "non-atomic arbitrage rarely addressed").

export interface NonAtomicArbitrageEvent {
  address: string;
  firstTxHash: string;
  secondTxHash: string;
  tokenAddress: string;
  profitRaw: string;
}

interface SwapRow {
  transaction_hash: string;
  transaction_position: string;
  contract_address: string;
  from_address: string;
  token_in_address: string;
  token_in_amount: string;
  token_out_address: string;
  token_out_amount: string;
}

export async function getNonAtomicArbitrageForBlock(
  blockNumber: number,
): Promise<NonAtomicArbitrageEvent[]> {
  const { rows } = await pool.query<SwapRow>(
    `SELECT transaction_hash, transaction_position, contract_address, from_address,
            token_in_address, token_in_amount, token_out_address, token_out_amount
     FROM swaps WHERE block_number = $1 ORDER BY transaction_position ASC`,
    [blockNumber],
  );

  const byAddress = new Map<string, SwapRow[]>();
  for (const r of rows) {
    if (!byAddress.has(r.from_address)) byAddress.set(r.from_address, []);
    byAddress.get(r.from_address)!.push(r);
  }

  const results: NonAtomicArbitrageEvent[] = [];
  for (const [address, swaps] of byAddress) {
    if (swaps.length < 2) continue;

    for (let i = 0; i < swaps.length; i++) {
      const a = swaps[i];
      for (let j = i + 1; j < swaps.length; j++) {
        const b = swaps[j];
        if (a.transaction_hash === b.transaction_hash) continue; // atomic - already covered by arbitrage classifier
        if (a.contract_address === b.contract_address) continue; // same pool, not a real route
        if (a.token_in_address !== b.token_out_address) continue;
        if (a.token_out_address !== b.token_in_address) continue;

        // Sharing a token pair + direction isn't enough on its own - two
        // unrelated trades by the same busy address (a market maker, an
        // aggregator router) can coincidentally face opposite ways. Require
        // the connecting leg (what leg A produced vs. what leg B consumed)
        // to be roughly the same size, or this isn't really one continuous
        // round-trip of the same capital.
        const outA = Number(a.token_out_amount);
        const inB = Number(b.token_in_amount);
        if (outA <= 0 || inB <= 0) continue;
        const sizeRatio = Math.min(outA, inB) / Math.max(outA, inB);
        if (sizeRatio < 0.7) continue;

        let profit: bigint;
        try {
          profit = BigInt(b.token_out_amount) - BigInt(a.token_in_amount);
        } catch {
          continue;
        }
        if (profit <= 0n) continue;

        results.push({
          address,
          firstTxHash: a.transaction_hash,
          secondTxHash: b.transaction_hash,
          tokenAddress: a.token_in_address,
          profitRaw: profit.toString(),
        });
      }
    }
  }

  return results;
}

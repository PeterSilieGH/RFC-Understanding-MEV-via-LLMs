import { pool } from "@mev/db";

// Liquidation race: more than one searcher tries to liquidate the same
// borrower position in the same block; only one succeeds, the rest revert
// (or land after the position is already gone). Standard liquidation
// tracking (including mev-inspect-py's `liquidations` table) only records
// the winning call, so the competitive gas-war dynamic - and the fact that
// losing searchers paid gas for nothing - is invisible. classified_traces
// keeps every decoded call regardless of success, which is what makes this
// detectable at all without touching the Python pipeline.
//
// Per-protocol because the function name and the borrower's argument name
// differ (Aave's liquidationCall(..., address _user, ...) vs. Compound-style
// liquidateBorrow(address borrower, ...)) - add more specs here as the
// underlying classifiers gain coverage for those protocols.
const LIQUIDATION_CALL_SPECS = [
  { abiName: "AaveLendingPool", functionName: "liquidationCall", userField: "_user" },
];

export interface LiquidationRaceEvent {
  borrower: string;
  winnerTxHash: string;
  winnerAddress: string;
  loserTxHashes: string[];
}

interface Attempt {
  transactionHash: string;
  position: number;
  fromAddress: string;
  user: string;
  failed: boolean;
}

export async function getLiquidationRacesForBlock(
  blockNumber: number,
): Promise<LiquidationRaceEvent[]> {
  const results: LiquidationRaceEvent[] = [];

  for (const spec of LIQUIDATION_CALL_SPECS) {
    const { rows } = await pool.query(
      `SELECT transaction_hash, transaction_position, from_address, inputs, error
       FROM classified_traces
       WHERE block_number = $1 AND abi_name = $2 AND function_name = $3`,
      [blockNumber, spec.abiName, spec.functionName],
    );

    // the same call can appear at multiple trace depths (e.g. through a
    // proxy) - dedupe to one attempt per transaction
    const byTx = new Map<string, Attempt>();
    for (const r of rows) {
      if (byTx.has(r.transaction_hash)) continue;
      const user = r.inputs?.[0]?.[spec.userField];
      if (!user) continue;
      byTx.set(r.transaction_hash, {
        transactionHash: r.transaction_hash,
        position: Number(r.transaction_position),
        fromAddress: r.from_address,
        user,
        failed: r.error != null,
      });
    }

    const byUser = new Map<string, Attempt[]>();
    for (const attempt of byTx.values()) {
      if (!byUser.has(attempt.user)) byUser.set(attempt.user, []);
      byUser.get(attempt.user)!.push(attempt);
    }

    for (const [user, attempts] of byUser) {
      if (attempts.length < 2) continue;
      attempts.sort((a, b) => a.position - b.position);
      const winner = attempts.find((a) => !a.failed) || attempts[0];
      const losers = attempts.filter((a) => a !== winner);
      if (losers.length === 0) continue;

      results.push({
        borrower: user,
        winnerTxHash: winner.transactionHash,
        winnerAddress: winner.fromAddress,
        loserTxHashes: losers.map((l) => l.transactionHash),
      });
    }
  }

  return results;
}

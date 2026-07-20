// Moved in-pipeline from apps/explorer-api/src/detectors/liquidationRace.ts
// (ADR-010). Multiple searchers race to liquidate the same borrower in one
// block; only one wins, the rest revert. classified_traces keeps every decoded
// call (winners and losers), which is what makes this detectable. Per-protocol
// because the borrower argument name differs; extend as classifiers gain
// coverage. In-pipeline we read the decoded inputs dict directly.
import type { ClassifiedTrace, LiquidationRaceEvent } from "../types.js";

const LIQUIDATION_CALL_SPECS = [
  { abiName: "AaveLendingPool", functionName: "liquidationCall", userField: "_user" },
];

interface Attempt {
  transactionHash: string;
  position: number;
  fromAddress: string;
  user: string;
  failed: boolean;
}

export function detectLiquidationRaces(
  blockNumber: number,
  classifiedTraces: ClassifiedTrace[],
): LiquidationRaceEvent[] {
  const results: LiquidationRaceEvent[] = [];

  for (const spec of LIQUIDATION_CALL_SPECS) {
    const traces = classifiedTraces.filter(
      (t) => t.abiName === spec.abiName && t.functionName === spec.functionName,
    );

    // the same call can appear at multiple trace depths (proxy) — one per tx
    const byTx = new Map<string, Attempt>();
    for (const t of traces) {
      if (byTx.has(t.transactionHash)) continue;
      const user = t.inputs?.[spec.userField] as string | undefined;
      if (!user) continue;
      byTx.set(t.transactionHash, {
        transactionHash: t.transactionHash,
        position: t.transactionPosition,
        fromAddress: t.fromAddress ?? "",
        user,
        failed: t.error != null,
      });
    }

    const byUser = new Map<string, Attempt[]>();
    for (const attempt of byTx.values()) {
      const list = byUser.get(attempt.user);
      if (list) list.push(attempt);
      else byUser.set(attempt.user, [attempt]);
    }

    for (const [user, attempts] of byUser) {
      if (attempts.length < 2) continue;
      attempts.sort((a, b) => a.position - b.position);
      const winner = attempts.find((a) => !a.failed) ?? attempts[0];
      const losers = attempts.filter((a) => a !== winner);
      if (losers.length === 0) continue;

      results.push({
        blockNumber,
        borrower: user,
        winnerTxHash: winner.transactionHash,
        winnerAddress: winner.fromAddress,
        loserTxHashes: losers.map((l) => l.transactionHash),
      });
    }
  }

  return results;
}

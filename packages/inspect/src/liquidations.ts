// Ports mev_inspect/liquidations.py. A liquidation is a `liquidate`-classified
// call that isn't itself nested inside another liquidation and didn't revert;
// the protocol's LiquidationClassifier reads the debt/received transfers.
import { getClassifier } from "./classifiers/registry.js";
import { getChildTraces, isChildTraceAddress } from "./traces.js";
import { getChildTransfers } from "./transfers.js";
import {
  type ClassifiedTrace,
  type DecodedCallTrace,
  type Liquidation,
  isDecodedCall,
} from "./types.js";

export function getLiquidations(traces: ClassifiedTrace[]): Liquidation[] {
  const liquidations: Liquidation[] = [];
  const parentLiquidations: DecodedCallTrace[] = [];

  for (const trace of traces) {
    if (!isDecodedCall(trace)) continue;
    if (isChildLiquidation(trace, parentLiquidations)) continue;
    if (trace.error === "Reverted") continue;

    if (trace.classification === "liquidate") {
      parentLiquidations.push(trace);
      const childTraces = getChildTraces(trace.transactionHash, trace.traceAddress, traces);
      const childTransfers = getChildTransfers(
        trace.transactionHash,
        trace.traceAddress,
        childTraces,
      );
      const classifier = getClassifier(trace);
      if (classifier !== null && classifier.classification === "liquidate") {
        const liquidation = classifier.parseLiquidation(trace, childTransfers, childTraces);
        if (liquidation !== null) liquidations.push(liquidation);
      }
    }
  }

  return liquidations;
}

function isChildLiquidation(trace: DecodedCallTrace, parents: DecodedCallTrace[]): boolean {
  return parents.some(
    (parent) =>
      trace.transactionHash === parent.transactionHash &&
      isChildTraceAddress(trace.traceAddress, parent.traceAddress),
  );
}

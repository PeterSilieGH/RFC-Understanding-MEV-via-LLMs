// Shared Compound-V2 / Cream liquidation logic (ports the identical classifier
// in specs/compound.py and specs/cream.py — they differ only in the cEther-style
// token address).
import {
  type ClassifiedTrace,
  type DecodedCallTrace,
  ETH_TOKEN_ADDRESS,
  type Liquidation,
  type LiquidationClassifier,
  type Protocol,
  type SeizeClassifier,
  type Transfer,
} from "../../types.js";
import { getDebtTransfer, getReceivedTransfer } from "../helpers.js";

export const seizeClassifier: SeizeClassifier = { classification: "seize" };

function getSeizeCall(traces: ClassifiedTrace[]): ClassifiedTrace | null {
  return traces.find((t) => t.classification === "seize") ?? null;
}

export function makeCompoundLiquidationClassifier(cEtherAddress: string): LiquidationClassifier {
  return {
    classification: "liquidate",
    parseLiquidation(
      trace: DecodedCallTrace,
      childTransfers: Transfer[],
      childTraces: ClassifiedTrace[],
    ): Liquidation | null {
      const liquidator = trace.fromAddress;
      const liquidated = trace.inputs.borrower as string;

      let debtTokenAddress = trace.toAddress;
      let receivedTokenAddress = trace.inputs.cTokenCollateral as string;
      let debtPurchaseAmount: bigint;
      let receivedAmount: bigint | null = null;

      if (debtTokenAddress === cEtherAddress && (trace.value ?? 0n) !== 0n) {
        debtPurchaseAmount = trace.value ?? 0n;
        debtTokenAddress = ETH_TOKEN_ADDRESS;
      } else {
        debtPurchaseAmount = (trace.inputs.repayAmount as bigint | undefined) ?? 0n;
        debtTokenAddress = cEtherAddress;
      }

      const debtTransfer = getDebtTransfer(liquidator, childTransfers);
      const receivedTransfer = getReceivedTransfer(liquidator, childTransfers);
      const seizeTrace = getSeizeCall(childTraces);

      if (debtTransfer !== null) {
        debtTokenAddress = debtTransfer.tokenAddress;
        debtPurchaseAmount = debtTransfer.amount;
      }

      if (receivedTransfer !== null) {
        receivedTokenAddress = receivedTransfer.tokenAddress;
        receivedAmount = receivedTransfer.amount;
      } else if (seizeTrace !== null && seizeTrace.inputs !== null) {
        receivedAmount = seizeTrace.inputs.seizeTokens as bigint;
      }

      if (receivedAmount === null) return null;

      return {
        liquidatedUser: liquidated,
        debtTokenAddress,
        liquidatorUser: liquidator,
        debtPurchaseAmount,
        protocol: trace.protocol as Protocol,
        receivedAmount,
        receivedTokenAddress,
        transactionHash: trace.transactionHash,
        traceAddress: trace.traceAddress,
        blockNumber: trace.blockNumber,
        error: trace.error,
      };
    },
  };
}

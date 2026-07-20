// Ports mev_inspect/classifiers/specs/aave.py (Aave V1/V2 lending pool).
import {
  type ClassifierSpec,
  type DecodedCallTrace,
  type Liquidation,
  type LiquidationClassifier,
  Protocol,
  type Transfer,
  type TransferClassifier,
} from "../../types.js";
import { getDebtTransfer, getReceivedTransfer } from "../helpers.js";

const aaveLiquidationClassifier: LiquidationClassifier = {
  classification: "liquidate",
  parseLiquidation(trace: DecodedCallTrace, childTransfers: Transfer[]): Liquidation | null {
    const liquidator = trace.fromAddress;
    const liquidated = trace.inputs._user as string;

    const debtTransfer = getDebtTransfer(liquidator, childTransfers);
    const receivedTransfer = getReceivedTransfer(liquidator, childTransfers);

    if (debtTransfer === null || receivedTransfer === null) return null;

    return {
      liquidatedUser: liquidated,
      debtTokenAddress: debtTransfer.tokenAddress,
      liquidatorUser: liquidator,
      debtPurchaseAmount: debtTransfer.amount,
      protocol: Protocol.aave,
      receivedAmount: receivedTransfer.amount,
      receivedTokenAddress: receivedTransfer.tokenAddress,
      transactionHash: trace.transactionHash,
      traceAddress: trace.traceAddress,
      blockNumber: trace.blockNumber,
      error: trace.error,
    };
  },
};

const aaveTransferClassifier: TransferClassifier = {
  classification: "transfer",
  getTransfer(trace: DecodedCallTrace): Transfer {
    return {
      blockNumber: trace.blockNumber,
      transactionHash: trace.transactionHash,
      traceAddress: trace.traceAddress,
      amount: trace.inputs.value as bigint,
      toAddress: trace.inputs.to as string,
      fromAddress: trace.inputs.from as string,
      tokenAddress: trace.toAddress,
    };
  },
};

export const AAVE_CLASSIFIER_SPECS: ClassifierSpec[] = [
  {
    abiName: "AaveLendingPool",
    protocol: Protocol.aave,
    classifiers: {
      "liquidationCall(address,address,address,uint256,bool)": aaveLiquidationClassifier,
    },
  },
  {
    abiName: "aTokens",
    protocol: Protocol.aave,
    classifiers: {
      "transferOnLiquidation(address,address,uint256)": aaveTransferClassifier,
    },
  },
];

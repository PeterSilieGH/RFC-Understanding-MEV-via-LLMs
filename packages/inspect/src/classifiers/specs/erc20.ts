// Ports mev_inspect/classifiers/specs/erc20.py.
import type {
  ClassifierSpec,
  DecodedCallTrace,
  Transfer,
  TransferClassifier,
} from "../../types.js";

const erc20TransferClassifier: TransferClassifier = {
  classification: "transfer",
  getTransfer(trace: DecodedCallTrace): Transfer {
    return {
      blockNumber: trace.blockNumber,
      transactionHash: trace.transactionHash,
      traceAddress: trace.traceAddress,
      amount: trace.inputs.amount as bigint,
      toAddress: trace.inputs.recipient as string,
      fromAddress: (trace.inputs.sender as string | undefined) ?? trace.fromAddress,
      tokenAddress: trace.toAddress,
    };
  },
};

export const ERC20_CLASSIFIER_SPECS: ClassifierSpec[] = [
  {
    abiName: "ERC20",
    classifiers: {
      "transferFrom(address,address,uint256)": erc20TransferClassifier,
      "transfer(address,uint256)": erc20TransferClassifier,
    },
  },
];

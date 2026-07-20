// Ports mev_inspect/classifiers/specs/weth.py.
import {
  type ClassifierSpec,
  type DecodedCallTrace,
  Protocol,
  type Transfer,
  type TransferClassifier,
  WETH_TOKEN_ADDRESS,
} from "../../types.js";

const wethTransferClassifier: TransferClassifier = {
  classification: "transfer",
  getTransfer(trace: DecodedCallTrace): Transfer {
    return {
      blockNumber: trace.blockNumber,
      transactionHash: trace.transactionHash,
      traceAddress: trace.traceAddress,
      amount: trace.inputs.wad as bigint,
      toAddress: trace.inputs.dst as string,
      fromAddress: trace.fromAddress,
      tokenAddress: trace.toAddress,
    };
  },
};

export const WETH_CLASSIFIER_SPECS: ClassifierSpec[] = [
  {
    abiName: "WETH9",
    protocol: Protocol.weth,
    validContractAddresses: [WETH_TOKEN_ADDRESS],
    classifiers: {
      "transferFrom(address,address,uint256)": wethTransferClassifier,
      "transfer(address,uint256)": wethTransferClassifier,
    },
  },
];

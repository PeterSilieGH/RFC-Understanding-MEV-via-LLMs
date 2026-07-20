// Ports mev_inspect/classifiers/specs/bancor.py.
import {
  type ClassifierSpec,
  type DecodedCallTrace,
  Protocol,
  type Swap,
  type SwapClassifier,
  type Transfer,
} from "../../types.js";
import { createSwapFromRecipientTransfers } from "../helpers.js";

const BANCOR_NETWORK_CONTRACT_ADDRESS = "0x2f9ec37d6ccfff1cab21733bdadede11c823ccb0";

const bancorSwapClassifier: SwapClassifier = {
  classification: "swap",
  parseSwap(trace: DecodedCallTrace, prior: Transfer[], child: Transfer[]): Swap | null {
    return createSwapFromRecipientTransfers(
      trace,
      BANCOR_NETWORK_CONTRACT_ADDRESS,
      trace.fromAddress,
      prior,
      child,
    );
  },
};

export const BANCOR_CLASSIFIER_SPECS: ClassifierSpec[] = [
  {
    abiName: "BancorNetwork",
    protocol: Protocol.bancor,
    validContractAddresses: [BANCOR_NETWORK_CONTRACT_ADDRESS],
    classifiers: {
      "convertByPath(address[],uint256,uint256,address,address,uint256)": bancorSwapClassifier,
    },
  },
];

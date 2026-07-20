// Ports mev_inspect/classifiers/specs/balancer.py (Balancer V1 BPool).
import {
  type ClassifierSpec,
  type DecodedCallTrace,
  Protocol,
  type Swap,
  type SwapClassifier,
  type Transfer,
} from "../../types.js";
import { createSwapFromPoolTransfers } from "../helpers.js";

const balancerSwapClassifier: SwapClassifier = {
  classification: "swap",
  parseSwap(trace: DecodedCallTrace, prior: Transfer[], child: Transfer[]): Swap | null {
    return createSwapFromPoolTransfers(trace, trace.fromAddress, prior, child);
  },
};

export const BALANCER_CLASSIFIER_SPECS: ClassifierSpec[] = [
  {
    abiName: "BPool",
    protocol: Protocol.balancer_v1,
    classifiers: {
      "swapExactAmountIn(address,uint256,address,uint256,uint256)": balancerSwapClassifier,
      "swapExactAmountOut(address,uint256,address,uint256,uint256)": balancerSwapClassifier,
    },
  },
];

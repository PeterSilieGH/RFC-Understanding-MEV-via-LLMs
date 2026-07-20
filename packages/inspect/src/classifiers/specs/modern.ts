// Modern-protocol classifiers (ADR-010, Phase 2b). Added via inline ABIs so a
// new protocol is one spec entry — no JSON file, no core change. These postdate
// mev-inspect-py, so there is no reference dataset to diff against; treat them as
// best-effort.
//
// Coverage split by risk:
//   - Aave V3 liquidations: fully classified. Same liquidationCall shape as V2,
//     discriminated by the V3 Pool address; profit/tokens come from the debt +
//     received transfers, exactly like the V2 classifier — so this is safe.
//   - Uniswap V4 (PoolManager + Universal Router) and Balancer V2 Vault:
//     DECODE-ONLY (no swap classifier). They correctly label these calls in
//     classified_traces (function name + protocol) for the trace view / agent,
//     but do NOT emit swaps — their singleton/flash-accounting or batched
//     designs need transfer-delta extraction, a scoped follow-up. Decode-only
//     means zero risk of false swaps/arbs.
import {
  type ClassifierSpec,
  type DecodedCallTrace,
  type Liquidation,
  type LiquidationClassifier,
  Protocol,
  type Transfer,
} from "../../types.js";
import { getDebtTransfer, getReceivedTransfer } from "../helpers.js";

// --- Aave V3 (mainnet Pool) -------------------------------------------------
const AAVE_V3_POOL = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";

const aaveV3LiquidationClassifier: LiquidationClassifier = {
  classification: "liquidate",
  parseLiquidation(trace: DecodedCallTrace, childTransfers: Transfer[]): Liquidation | null {
    const liquidator = trace.fromAddress;
    const liquidated = trace.inputs.user as string;

    const debtTransfer = getDebtTransfer(liquidator, childTransfers);
    const receivedTransfer = getReceivedTransfer(liquidator, childTransfers);
    if (debtTransfer === null || receivedTransfer === null) return null;

    return {
      liquidatedUser: liquidated,
      debtTokenAddress: debtTransfer.tokenAddress,
      liquidatorUser: liquidator,
      debtPurchaseAmount: debtTransfer.amount,
      protocol: Protocol.aave_v3,
      receivedAmount: receivedTransfer.amount,
      receivedTokenAddress: receivedTransfer.tokenAddress,
      transactionHash: trace.transactionHash,
      traceAddress: trace.traceAddress,
      blockNumber: trace.blockNumber,
      error: trace.error,
    };
  },
};

// --- decode-only singletons -------------------------------------------------
const UNISWAP_V4_POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";
const UNIVERSAL_ROUTER_ADDRESSES = [
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  "0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b",
];
const BALANCER_V2_VAULT = "0xba12222222228d8ba445958a75a0704d566bf2c8";

export const MODERN_CLASSIFIER_SPECS: ClassifierSpec[] = [
  {
    abiName: "AaveV3Pool",
    protocol: Protocol.aave_v3,
    validContractAddresses: [AAVE_V3_POOL],
    abi: [
      "function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)",
    ],
    classifiers: {
      "liquidationCall(address,address,address,uint256,bool)": aaveV3LiquidationClassifier,
    },
  },
  {
    abiName: "UniswapV4PoolManager",
    protocol: Protocol.uniswap_v4,
    validContractAddresses: [UNISWAP_V4_POOL_MANAGER],
    // decode-only: label the singleton's entrypoints, don't extract swaps yet
    abi: ["function unlock(bytes data) returns (bytes)"],
  },
  {
    abiName: "UniversalRouter",
    protocol: Protocol.uniswap_v4,
    validContractAddresses: UNIVERSAL_ROUTER_ADDRESSES,
    abi: [
      "function execute(bytes commands, bytes[] inputs)",
      "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
    ],
  },
  {
    abiName: "BalancerV2Vault",
    protocol: Protocol.balancer_v2,
    validContractAddresses: [BALANCER_V2_VAULT],
    // decode-only: batched/singleton swaps need transfer-delta extraction
    abi: [
      "function swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256) returns (uint256)",
      "function batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256) returns (int256[])",
    ],
  },
];

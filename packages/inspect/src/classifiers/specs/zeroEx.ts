// Ports mev_inspect/classifiers/specs/zero_ex.py (0x exchange proxy + native
// order features). Swaps are read from the RFQ/limit order tuple plus the two
// settlement transfers. Divergence: the Python helper raises when it can't find
// matching transfers; we return null (skip the swap) so one odd order can't
// abort a whole block's inspection.
import {
  type ClassifierSpec,
  type DecodedCallTrace,
  Protocol,
  type Swap,
  type SwapClassifier,
  type Transfer,
} from "../../types.js";

const ANY_TAKER_ADDRESS = "0x0000000000000000000000000000000000000000";

const RFQ_SIGNATURES = new Set([
  "fillRfqOrder((address,address,uint128,uint128,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128)",
  "_fillRfqOrder((address,address,uint128,uint128,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128,address,bool,address)",
]);
const LIMIT_SIGNATURES = new Set([
  "fillOrKillLimitOrder((address,address,uint128,uint128,uint128,address,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128)",
  "fillLimitOrder((address,address,uint128,uint128,uint128,address,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128)",
  "_fillLimitOrder((address,address,uint128,uint128,uint128,address,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128,address,address)",
]);

function takerTokenTransferAmount(
  trace: DecodedCallTrace,
  takerAddress: string,
  tokenAddress: string,
  childTransfers: Transfer[],
): bigint | null {
  if (trace.error !== null) return 0n;
  if (childTransfers.length < 2) return null;

  if (takerAddress === ANY_TAKER_ADDRESS) {
    for (const transfer of childTransfers) {
      if (transfer.tokenAddress === tokenAddress) return transfer.amount;
    }
  } else {
    for (const transfer of childTransfers) {
      if (transfer.toAddress === takerAddress) return transfer.amount;
    }
  }
  return null; // (Python raises here; we skip the swap instead)
}

function tokenOutData(
  trace: DecodedCallTrace,
  childTransfers: Transfer[],
): [string, bigint] | null {
  const order = trace.inputs.order as unknown[];
  const tokenOutAddress = order[0] as string;

  let takerAddress: string;
  if (RFQ_SIGNATURES.has(trace.functionSignature)) takerAddress = order[5] as string;
  else if (LIMIT_SIGNATURES.has(trace.functionSignature)) takerAddress = order[6] as string;
  else return null;

  const amount = takerTokenTransferAmount(trace, takerAddress, tokenOutAddress, childTransfers);
  if (amount === null) return null;
  return [tokenOutAddress, amount];
}

const zeroExSwapClassifier: SwapClassifier = {
  classification: "swap",
  parseSwap(trace: DecodedCallTrace, _prior: Transfer[], child: Transfer[]): Swap | null {
    if (child.length < 2) return null;
    const out = tokenOutData(trace, child);
    if (out === null) return null;
    const [tokenOutAddress, tokenOutAmount] = out;

    const order = trace.inputs.order as unknown[];
    const tokenInAddress = order[1] as string;
    const tokenInAmount = trace.inputs.takerTokenFillAmount as bigint;

    return {
      abiName: trace.abiName,
      transactionHash: trace.transactionHash,
      transactionPosition: trace.transactionPosition,
      blockNumber: trace.blockNumber,
      traceAddress: trace.traceAddress,
      contractAddress: trace.toAddress,
      protocol: Protocol.zero_ex,
      fromAddress: trace.fromAddress,
      toAddress: trace.toAddress,
      tokenInAddress,
      tokenInAmount,
      tokenOutAddress,
      tokenOutAmount,
      error: trace.error,
    };
  },
};

const contract = (abiName: string, address: string): ClassifierSpec => ({
  abiName,
  protocol: Protocol.zero_ex,
  validContractAddresses: [address],
});

const ZEROX_CONTRACT_SPECS: ClassifierSpec[] = [
  contract("exchangeProxy", "0xDef1C0ded9bec7F1a1670819833240f027b25EfF"),
  contract("exchangeProxyAllowanceTarget", "0xf740b67da229f2f10bcbd38a7979992fcc71b8eb"),
  contract("exchangeProxyFlashWallet", "0x22f9dcf4647084d6c31b2765f6910cd85c178c18"),
  contract("exchangeProxyGovernor", "0x618f9c67ce7bf1a50afa1e7e0238422601b0ff6e"),
  contract("exchangeProxyLiquidityProviderSandbox", "0x407b4128e9ecad8769b2332312a9f655cb9f5f3a"),
  contract("exchangeProxyTransformerDeployer", "0x39dce47a67ad34344eab877eae3ef1fa2a1d50bb"),
  contract("wethTransformer", "0xb2bc06a4efb20fc6553a69dbfa49b7be938034a7"),
  contract("payTakerTransformer", "0x4638a7ebe75b911b995d0ec73a81e4f85f41f24e"),
  contract("fillQuoteTransformer", "0x5ce5174d7442061135ea849970ffc7763920e0fd"),
  contract("affiliateFeeTransformer", "0xda6d9fc5998f550a094585cf9171f0e8ee3ac59f"),
  contract("staking", "0x2a17c35ff147b32f13f19f2e311446eeb02503f3"),
  contract("stakingProxy", "0xa26e80e7dea86279c6d778d702cc413e6cffa777"),
  contract("zrxToken", "0xe41d2489571d322189246dafa5ebde1f4699f498"),
  contract("zrxVault", "0xba7f8b5fb1b19c1211c5d49550fcd149177a5eaf"),
  contract("devUtils", "0x74134cf88b21383713e096a5ecf59e297dc7f547"),
  contract("etherToken", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"),
  contract("erc20BridgeSampler", "0xd8c38704c9937ea3312de29f824b4ad3450a5e61"),
];

const generic = (abiName: string): ClassifierSpec => ({ abiName, protocol: Protocol.zero_ex });

const ZEROX_GENERIC_SPECS: ClassifierSpec[] = [
  generic("IBatchFillNativeOrdersFeature"),
  generic("IFeature"),
  generic("IFundRecoveryFeature"),
  generic("ILiquidityProviderFeature"),
  generic("IMetaTransactionsFeature"),
  generic("IMultiplexFeature"),
  {
    abiName: "INativeOrdersFeature",
    protocol: Protocol.zero_ex,
    validContractAddresses: ["0xdef1c0ded9bec7f1a1670819833240f027b25eff"],
    classifiers: {
      "fillOrKillLimitOrder((address,address,uint128,uint128,uint128,address,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128)":
        zeroExSwapClassifier,
      "fillRfqOrder((address,address,uint128,uint128,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128)":
        zeroExSwapClassifier,
      "fillLimitOrder((address,address,uint128,uint128,uint128,address,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128)":
        zeroExSwapClassifier,
      "_fillRfqOrder((address,address,uint128,uint128,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128,address,bool,address)":
        zeroExSwapClassifier,
      "_fillLimitOrder((address,address,uint128,uint128,uint128,address,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128,address,address)":
        zeroExSwapClassifier,
    },
  },
  generic("IOtcOrdersFeature"),
  generic("IOwnableFeature"),
  generic("IPancakeSwapFeature"),
  generic("ISimpleFunctionRegistryFeature"),
  generic("ITestSimpleFunctionRegistryFeature"),
  generic("ITokenSpenderFeature"),
  generic("ITransformERC20Feature"),
  generic("IUniswapFeature"),
  generic("IUniswapV3Feature"),
  generic("IBootstrapFeature"),
];

export const ZEROX_CLASSIFIER_SPECS: ClassifierSpec[] = [
  ...ZEROX_CONTRACT_SPECS,
  ...ZEROX_GENERIC_SPECS,
];

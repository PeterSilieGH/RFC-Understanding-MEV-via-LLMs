// Ports mev_inspect/classifiers/specs/uniswap.py. Pools are matched by ABI +
// swap signature (not address), so any Uniswap V2/V3 or Sushiswap pool is
// covered. The contract specs (factory/router/position-manager) exist so those
// contracts' calls (e.g. NonfungiblePositionManager mint/decreaseLiquidity,
// which the JIT-liquidity detector needs) get decoded.
import {
  type ClassifierSpec,
  type DecodedCallTrace,
  Protocol,
  type Swap,
  type SwapClassifier,
  type Transfer,
} from "../../types.js";
import { createSwapFromPoolTransfers } from "../helpers.js";

const uniswapV3SwapClassifier: SwapClassifier = {
  classification: "swap",
  parseSwap(trace: DecodedCallTrace, prior: Transfer[], child: Transfer[]): Swap | null {
    const recipient = (trace.inputs.recipient as string | undefined) ?? trace.fromAddress;
    return createSwapFromPoolTransfers(trace, recipient, prior, child);
  },
};

const uniswapV2SwapClassifier: SwapClassifier = {
  classification: "swap",
  parseSwap(trace: DecodedCallTrace, prior: Transfer[], child: Transfer[]): Swap | null {
    const recipient = (trace.inputs.to as string | undefined) ?? trace.fromAddress;
    return createSwapFromPoolTransfers(trace, recipient, prior, child);
  },
};

const UNISWAP_V3_CONTRACT_SPECS: ClassifierSpec[] = [
  {
    abiName: "UniswapV3Factory",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0x1F98431c8aD98523631AE4a59f267346ea31F984"],
  },
  {
    abiName: "Multicall2",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696"],
  },
  {
    abiName: "ProxyAdmin",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0xB753548F6E010e7e680BA186F9Ca1BdAB2E90cf2"],
  },
  {
    abiName: "TickLens",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0xbfd8137f7d1516D3ea5cA83523914859ec47F573"],
  },
  {
    abiName: "Quoter",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"],
  },
  {
    abiName: "SwapRouter",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0xE592427A0AEce92De3Edee1F18E0157C05861564"],
  },
  {
    abiName: "NFTDescriptor",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0x42B24A95702b9986e82d421cC3568932790A48Ec"],
  },
  {
    abiName: "NonfungibleTokenPositionDescriptor",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0x91ae842A5Ffd8d12023116943e72A606179294f3"],
  },
  {
    abiName: "TransparentUpgradeableProxy",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0xEe6A57eC80ea46401049E92587E52f5Ec1c24785"],
  },
  {
    abiName: "NonfungiblePositionManager",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
  },
  {
    abiName: "V3Migrator",
    protocol: Protocol.uniswap_v3,
    validContractAddresses: ["0xA5644E29708357803b5A882D272c41cC0dF92B34"],
  },
];

const UNISWAP_V3_GENERAL_SPECS: ClassifierSpec[] = [
  {
    abiName: "UniswapV3Pool",
    protocol: Protocol.uniswap_v3,
    classifiers: { "swap(address,bool,int256,uint160,bytes)": uniswapV3SwapClassifier },
  },
  { abiName: "IUniswapV3SwapCallback" },
  { abiName: "IUniswapV3MintCallback" },
  { abiName: "IUniswapV3FlashCallback" },
];

const UNISWAPPY_V2_CONTRACT_SPECS: ClassifierSpec[] = [
  {
    abiName: "UniswapV2Router",
    protocol: Protocol.uniswap_v2,
    validContractAddresses: ["0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"],
  },
  {
    abiName: "UniswapV2Router",
    protocol: Protocol.sushiswap,
    validContractAddresses: ["0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"],
  },
];

const UNISWAPPY_V2_PAIR_SPEC: ClassifierSpec = {
  abiName: "UniswapV2Pair",
  protocol: Protocol.uniswap_v2,
  classifiers: { "swap(uint256,uint256,address,bytes)": uniswapV2SwapClassifier },
};

export const UNISWAP_CLASSIFIER_SPECS: ClassifierSpec[] = [
  ...UNISWAP_V3_CONTRACT_SPECS,
  ...UNISWAPPY_V2_CONTRACT_SPECS,
  ...UNISWAP_V3_GENERAL_SPECS,
  UNISWAPPY_V2_PAIR_SPEC,
];

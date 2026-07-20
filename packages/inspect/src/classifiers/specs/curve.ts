// Ports mev_inspect/classifiers/specs/curve.py. Generated from the source spec
// tables (58 pools). CurveTokenV* specs are decode-only; StableSwap* pools
// classify exchange / exchange_underlying as swaps.
import {
  type ClassifierSpec,
  type DecodedCallTrace,
  Protocol,
  type Swap,
  type SwapClassifier,
  type Transfer,
} from "../../types.js";
import { createSwapFromPoolTransfers } from "../helpers.js";

const curveSwapClassifier: SwapClassifier = {
  classification: "swap",
  parseSwap(trace: DecodedCallTrace, prior: Transfer[], child: Transfer[]): Swap | null {
    return createSwapFromPoolTransfers(trace, trace.fromAddress, prior, child);
  },
};

export const CURVE_CLASSIFIER_SPECS: ClassifierSpec[] = [
  {
    abiName: "CurveTokenV1",
    protocol: Protocol.curve,
    validContractAddresses: [
      "0x3b3ac5386837dc563660fb6a0937dfaa5924333b",
      "0xd905e2eaebe188fc92179b6350807d8bd91db0d8",
      "0x49849c98ae39fff122806c06791fa73784fb3675",
      "0x075b1bb99792c9e1041ba13afef80c91a1e70fb3",
      "0xc25a3a3b969415c80451098fa907ec722572917f",
      "0x9fc689ccada600b6df723d9e47d84d76664a1f23",
    ],
  },
  {
    abiName: "CurveTokenV2",
    protocol: Protocol.curve,
    validContractAddresses: [
      "0x6c3f90f043a72fa612cbac8115ee7e52bde6e490",
      "0xb19059ebb43466c323583928285a49f558e572fd",
    ],
  },
  {
    abiName: "CurveTokenV3",
    protocol: Protocol.curve,
    validContractAddresses: [
      "0xfd2a8fa60abd58efe3eee34dd494cd491dc14900",
      "0xaa17a236f2badc98ddc0cf999abb47d47fc0a6cf",
      "0x194ebd173f6cdace046c53eacce9b953f28411d1",
      "0x5282a4ef67d9c33135340fb3289cc1711c13638c",
      "0xcee60cfa923170e4f8204ae08b4fa6a3f5656f3a",
      "0x53a901d48795c58f485cbb38df08fa96a24669d5",
      "0x02d341ccb60faaf662bc0554d13778015d1b285c",
      "0xa3d87fffce63b53e0d54faa1cc983b7eb0b74a9c",
      "0x06325440d014e39736583c165c2963ba99faf14e",
      "0x571ff5b7b346f706aa48d696a9a4a288e9bb4091",
    ],
  },
  {
    abiName: "CurveTokenV4",
    protocol: Protocol.curve,
    validContractAddresses: ["0xca3d75ac011bf5ad07a98d02f18225f9bd9a6bdf"],
  },
  {
    abiName: "StableSwap3Pool",
    protocol: Protocol.curve,
    validContractAddresses: ["0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwapAAVE",
    protocol: Protocol.curve,
    validContractAddresses: ["0xdebf20617708857ebe4f679508e7b7863a8a8eee"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapAETH",
    protocol: Protocol.curve,
    validContractAddresses: ["0xa96a65c051bf88b4095ee1f2451c2a9d43f53ae2"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwapBUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x79a8c46dea5ada233abaffd40f3a0a2b1e5a4f27"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapCompound",
    protocol: Protocol.curve,
    validContractAddresses: ["0xa2b47e3d5c44877cca798226b7b8118f9bfb7a56"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapEURS",
    protocol: Protocol.curve,
    validContractAddresses: ["0x0ce6a5ff5217e38315f87032cf90686c96627caa"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwaphBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0x4ca9b3063ec5866a4b82e437059d2c43d1be596f"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwapIronBank",
    protocol: Protocol.curve,
    validContractAddresses: ["0x2dded6da1bf5dbdf597c45fcfaa3194e53ecfeaf"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapLink",
    protocol: Protocol.curve,
    validContractAddresses: ["0xf178c0b5bb7e7abf4e12a4838c7b7c5ba2c623c0"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwapPAX",
    protocol: Protocol.curve,
    validContractAddresses: ["0x06364f10b501e868329afbc005b3492902d6c763"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwaprenBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0x93054188d876f558f4a66b2ef1d97d16edf0895b"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwaprETH",
    protocol: Protocol.curve,
    validContractAddresses: ["0xf9440930043eb3997fc70e1339dbb11f341de7a8"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwapsAAVE",
    protocol: Protocol.curve,
    validContractAddresses: ["0xeb16ae0052ed37f479f7fe63849198df1765a733"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapsBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0x7fc77b5c7614e1533320ea6ddc2eb61fa00a9714"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwapsETH",
    protocol: Protocol.curve,
    validContractAddresses: ["0xc5424b857f758e906013f3555dad202e4bdb4567"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwapstETH",
    protocol: Protocol.curve,
    validContractAddresses: ["0xdc24316b9ae028f1497c275eb9192a3ea0f67022"],
    classifiers: { "exchange(int128,int128,uint256,uint256)": curveSwapClassifier },
  },
  {
    abiName: "StableSwapsUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0xa5407eae9ba41422680e2e00537571bcc53efbfd"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapUSDT",
    protocol: Protocol.curve,
    validContractAddresses: ["0x52ea46506b9cc5ef470c5bf89f17dc28bb35d85c"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapY",
    protocol: Protocol.curve,
    validContractAddresses: ["0x45f783cce6b7ff23b2ab2d70e416cdb7d6055f51"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapYv2",
    protocol: Protocol.curve,
    validContractAddresses: ["0x8925d9d9b4569d737a48499def3f67baa5a144b9"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "DepositBUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0xb6c057591e073249f2d9d88ba59a46cfc9b59edb"],
  },
  {
    abiName: "DepositCompound",
    protocol: Protocol.curve,
    validContractAddresses: ["0xeb21209ae4c2c9ff2a86aca31e123764a3b6bc06"],
  },
  {
    abiName: "DepositPAX",
    protocol: Protocol.curve,
    validContractAddresses: ["0xa50ccc70b6a011cffddf45057e39679379187287"],
  },
  {
    abiName: "DepositsUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0xfcba3e75865d2d561be8d220616520c171f12851"],
  },
  {
    abiName: "DepositTriCrypto",
    protocol: Protocol.curve,
    validContractAddresses: ["0x331af2e331bd619defaa5dac6c038f53fcf9f785"],
  },
  {
    abiName: "DepositUSDT",
    protocol: Protocol.curve,
    validContractAddresses: ["0xac795d2c97e60df6a99ff1c814727302fd747a80"],
  },
  {
    abiName: "DepositY",
    protocol: Protocol.curve,
    validContractAddresses: ["0xbbc81d23ea2c3ec7e56d39296f0cbb648873a5d3"],
  },
  {
    abiName: "CurveTokenV2",
    protocol: Protocol.curve,
    validContractAddresses: [
      "0x3a664ab939fd8482048609f652f9a0b0677337b9",
      "0xd2967f45c4f384deea880f807be904762a3dea07",
      "0x5b5cfe992adac0c9d48e05854b2d91c73a003858",
      "0x6d65b498cb23deaba52db31c93da9bffb340fb8f",
      "0x1aef73d49dedc4b1778d0706583995958dc862e6",
      "0xde5331ac4b3630f94853ff322b66407e0d6331e8",
      "0xc2ee6b0334c261ed60c72f6054450b61b8f18e35",
      "0x64eda51d3ad40d56b9dfc5554e06f94e1dd786fd",
      "0x97e2768e8e73511ca874545dc5ff8067eb19b787",
      "0x4f3e8f405cf5afc05d68142f3783bdfe13811522",
    ],
  },
  {
    abiName: "CurveTokenV3",
    protocol: Protocol.curve,
    validContractAddresses: [
      "0x410e3e86ef427e30b9235497143881f717d93c2a",
      "0x2fe94ea3d5d4a175184081439753de15aef9d614",
      "0x7eb40e450b9655f4b3cc4259bcc731c63ff55ae6",
      "0x7eb40e450b9655f4b3cc4259bcc731c63ff55ae6",
    ],
  },
  {
    abiName: "DepositbBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0xc45b2eee6e09ca176ca3bb5f7eee7c47bf93c756"],
  },
  {
    abiName: "DepositDUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x61e10659fe3aa93d036d099405224e4ac24996d0"],
  },
  {
    abiName: "DepositGUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x64448b78561690b70e17cbe8029a3e5c1bb7136e"],
  },
  {
    abiName: "DepositHUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x09672362833d8f703d5395ef3252d4bfa51c15ca"],
  },
  {
    abiName: "DepositLinkUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x1de7f0866e2c4adac7b457c58cc25c8688cda1f2"],
  },
  {
    abiName: "DepositMUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x803a2b40c5a9bb2b86dd630b274fa2a9202874c2"],
  },
  {
    abiName: "DepositoBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0xd5bcf53e2c81e1991570f33fa881c49eea570c8d"],
  },
  {
    abiName: "DepositpBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0x11f419adabbff8d595e7d5b223eee3863bb3902c"],
  },
  {
    abiName: "DepositRSV",
    protocol: Protocol.curve,
    validContractAddresses: ["0xbe175115bf33e12348ff77ccfee4726866a0fbd5"],
  },
  {
    abiName: "DeposittBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0xaa82ca713d94bba7a89ceab55314f9effeddc78c"],
  },
  {
    abiName: "DepositUSD",
    protocol: Protocol.curve,
    validContractAddresses: [
      "0xf1f85a74ad6c64315f85af52d3d46bf715236adc",
      "0x094d12e5b541784701fd8d65f11fc0598fbc63320x3c8caee4e09296800f8d29a68fa3837e2dae4940",
    ],
  },
  {
    abiName: "DepositUST",
    protocol: Protocol.curve,
    validContractAddresses: ["0xb0a0716841f2fc03fba72a891b8bb13584f52f2d"],
  },
  {
    abiName: "StableSwapbBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0x071c661b4deefb59e2a3ddb20db036821eee8f4b"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapDUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x8038c01a0390a8c547446a0b2c18fc9aefecc10c"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapGUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x4f062658eaaf2c1ccf8c8e36d6824cdf41167956"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapHUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x3ef6a01a0f81d6046290f3e2a8c5b843e738e604"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapLinkUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0xe7a24ef0c5e95ffb0f6684b813a78f2a3ad7d171"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapMUSD",
    protocol: Protocol.curve,
    validContractAddresses: ["0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapoBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0xd81da8d904b52208541bade1bd6595d8a251f8dd"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwappBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0x7f55dde206dbad629c080068923b36fe9d6bdbef"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapRSV",
    protocol: Protocol.curve,
    validContractAddresses: ["0xc18cc39da8b11da8c3541c598ee022258f9744da"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwaptBTC",
    protocol: Protocol.curve,
    validContractAddresses: ["0xc25099792e9349c7dd09759744ea681c7de2cb66"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapUSD",
    protocol: Protocol.curve,
    validContractAddresses: [
      "0x3e01dd8a5e1fb3481f0f589056b428fc308af0fb",
      "0x0f9cb53ebe405d49a0bbdbd291a65ff571bc83e1",
    ],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapUSDP",
    protocol: Protocol.curve,
    validContractAddresses: ["0x42d7025938bec20b69cbae5a77421082407f053a"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
  {
    abiName: "StableSwapUST",
    protocol: Protocol.curve,
    validContractAddresses: ["0x890f4e345b1daed0367a877a1612f86a1f86985f"],
    classifiers: {
      "exchange(int128,int128,uint256,uint256)": curveSwapClassifier,
      "exchange_underlying(int128,int128,uint256,uint256)": curveSwapClassifier,
    },
  },
];

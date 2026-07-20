// Ports mev_inspect/classifiers/specs/opensea.py (Wyvern exchange).
import {
  type ClassifierSpec,
  type DecodedCallTrace,
  type NftTrade,
  type NftTradeClassifier,
  Protocol,
  type Transfer,
} from "../../types.js";
import { createNftTradeFromTransfers } from "../helpers.js";

const OPENSEA_WALLET_ADDRESS = "0x5b3256965e7c3cf26e11fcaf296dfc8807c01073";

const openseaClassifier: NftTradeClassifier = {
  classification: "nft_trade",
  parseTrade(trace: DecodedCallTrace, childTransfers: Transfer[]): NftTrade | null {
    const addresses = trace.inputs.addrs as string[];
    const buyMaker = addresses[1];
    const sellMaker = addresses[8];
    const target = addresses[4];

    return createNftTradeFromTransfers(
      trace,
      childTransfers,
      target,
      sellMaker,
      buyMaker,
      OPENSEA_WALLET_ADDRESS,
    );
  },
};

export const OPENSEA_CLASSIFIER_SPECS: ClassifierSpec[] = [
  {
    abiName: "WyvernExchange",
    protocol: Protocol.opensea,
    validContractAddresses: ["0x7be8076f4ea4a4ad08075c2508e481d6c946d12b"],
    classifiers: {
      "atomicMatch_(address[14],uint256[18],uint8[8],bytes,bytes,bytes,bytes,bytes,bytes,uint8[2],bytes32[5])":
        openseaClassifier,
    },
  },
];

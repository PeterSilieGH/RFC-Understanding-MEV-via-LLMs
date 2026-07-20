// Ports mev_inspect/decode.py (+ schemas/abi.py). Uses ethers' Interface for
// selector lookup and ABI decoding. Decoded inputs are normalized to match the
// shape mev-inspect-py produced and stored: addresses lower-cased, integers as
// bigint, tuples/arrays as positional arrays. Returns null when the selector is
// not in this ABI or the calldata can't be decoded (mirrors the Python
// InsufficientDataBytes / NonEmptyPaddingBytes / OverflowError catch).
import { type FunctionFragment, Interface, type ParamType } from "ethers";
import type { RawAbi } from "./abi.js";
import type { CallData } from "./types.js";

// 0x + 8 hex chars
const SELECTOR_LENGTH = 10;

export class ABIDecoder {
  private readonly iface: Interface;

  constructor(abi: RawAbi) {
    this.iface = new Interface(abi);
  }

  decode(data: string | undefined): CallData | null {
    if (!data || data.length < SELECTOR_LENGTH) return null;
    const selector = data.slice(0, SELECTOR_LENGTH);

    let fragment: FunctionFragment | null;
    try {
      fragment = this.iface.getFunction(selector);
    } catch {
      return null;
    }
    if (fragment === null) return null;

    let decoded: ReadonlyArray<unknown>;
    try {
      decoded = this.iface.decodeFunctionData(fragment, data);
    } catch {
      return null;
    }

    const inputs: Record<string, unknown> = {};
    fragment.inputs.forEach((param, i) => {
      inputs[param.name || String(i)] = normalizeValue(decoded[i], param);
    });

    return {
      functionName: fragment.name,
      functionSignature: fragment.format("sighash"),
      inputs,
    };
  }
}

function normalizeValue(value: unknown, param: ParamType): unknown {
  if (param.baseType === "array" && param.arrayChildren) {
    return (value as unknown[]).map((v) => normalizeValue(v, param.arrayChildren as ParamType));
  }
  if (param.baseType === "tuple" && param.components) {
    // positional array, matching how Python serialized decoded structs
    return param.components.map((c, i) => normalizeValue((value as unknown[])[i], c));
  }
  if (param.baseType === "address") {
    return (value as string).toLowerCase();
  }
  // uint/int arrive as bigint from ethers v6; bool/bytes/string pass through
  return value;
}

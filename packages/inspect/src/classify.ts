// Ports mev_inspect/classifiers/trace.py. For each call trace, tries every
// classifier spec (respecting valid_contract_addresses), decodes the calldata
// against that spec's ABI, and — on a decode hit — tags the trace with the
// spec's protocol/abi and the classification for the matched function
// signature. Non-calls and undecodable calls fall through to `unknown`.
import { getAbi } from "./abi.js";
import { getSpecs } from "./classifiers/registry.js";
import { ABIDecoder } from "./decode.js";
import type { ClassifiedTrace, ClassifierSpec, RawTrace } from "./types.js";
import { hexToBigInt } from "./utils.js";

export class TraceClassifier {
  private readonly specs: ClassifierSpec[];
  private readonly decoders = new Map<string, ABIDecoder>();

  constructor(specs: ClassifierSpec[] = getSpecs()) {
    this.specs = specs;
    // Decoders are keyed by abi_name (matching mev-inspect-py); specs that
    // share an abi_name across protocols (e.g. UniswapV2Router for uniswap_v2
    // and sushiswap) share one decoder — their ABIs are identical.
    for (const spec of specs) {
      if (!this.decoders.has(spec.abiName)) {
        // Inline ABIs (spec.abi) let modern protocols be added without a JSON
        // file — used by the Phase-2b specs (ADR-010). Otherwise load from disk.
        const abi = spec.abi ?? getAbi(spec.abiName, spec.protocol);
        if (abi === null) throw new Error(`No ABI found for ${spec.abiName}`);
        this.decoders.set(spec.abiName, new ABIDecoder(abi));
      }
    }
  }

  classify(traces: RawTrace[]): ClassifiedTrace[] {
    const classified: ClassifiedTrace[] = [];
    for (const trace of traces) {
      if (trace.type === "reward") continue;
      classified.push(this.classifyTrace(trace));
    }
    return classified;
  }

  private classifyTrace(trace: RawTrace): ClassifiedTrace {
    if (trace.type === "call") {
      const classified = this.classifyCall(trace);
      if (classified !== null) return classified;
    }
    return this.baseTrace(trace);
  }

  private classifyCall(trace: RawTrace): ClassifiedTrace | null {
    const action = trace.action;
    const to = typeof action.to === "string" ? action.to.toLowerCase() : null;
    const from = typeof action.from === "string" ? action.from.toLowerCase() : null;
    const value = hexToBigInt(action.value);
    const gas = hexToBigInt(action.gas);
    const gasUsed = trace.result ? hexToBigInt(trace.result.gasUsed) : null;
    const input = typeof action.input === "string" ? action.input : "0x";

    for (const spec of this.specs) {
      if (spec.validContractAddresses !== undefined) {
        const valid = spec.validContractAddresses.map((a) => a.toLowerCase());
        if (to === null || !valid.includes(to)) continue;
      }

      const decoder = this.decoders.get(spec.abiName);
      if (decoder === undefined) continue;
      const callData = decoder.decode(input);
      if (callData === null) continue;

      const classifier = spec.classifiers?.[callData.functionSignature];
      const classification = classifier === undefined ? "unknown" : classifier.classification;

      return {
        ...this.commonFields(trace),
        classification,
        toAddress: to,
        fromAddress: from,
        value,
        gas,
        gasUsed,
        protocol: spec.protocol ?? null,
        abiName: spec.abiName,
        functionName: callData.functionName,
        functionSignature: callData.functionSignature,
        inputs: callData.inputs,
      };
    }

    // A call we couldn't decode: still carries to/from/value/gas.
    return {
      ...this.commonFields(trace),
      classification: "unknown",
      toAddress: to,
      fromAddress: from,
      value,
      gas,
      gasUsed,
      protocol: null,
      abiName: null,
      functionName: null,
      functionSignature: null,
      inputs: null,
    };
  }

  private baseTrace(trace: RawTrace): ClassifiedTrace {
    // Non-call traces (create / suicide): no decoded call fields.
    return {
      ...this.commonFields(trace),
      classification: "unknown",
      toAddress: null,
      fromAddress: null,
      value: null,
      gas: null,
      gasUsed: null,
      protocol: null,
      abiName: null,
      functionName: null,
      functionSignature: null,
      inputs: null,
    };
  }

  private commonFields(trace: RawTrace) {
    return {
      action: trace.action,
      blockNumber: trace.blockNumber,
      transactionHash: trace.transactionHash ?? "",
      transactionPosition: trace.transactionPosition ?? 0,
      traceAddress: trace.traceAddress,
      subtraces: trace.subtraces,
      type: trace.type,
      error: trace.error ?? null,
    };
  }
}

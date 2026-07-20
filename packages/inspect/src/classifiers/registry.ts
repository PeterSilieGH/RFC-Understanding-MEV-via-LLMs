// Ports mev_inspect/classifiers/specs/__init__.py. The registry is an ordered
// list of specs; classification tries them in order (ERC20 first, so any
// contract's transfer/transferFrom is caught as an ERC-20 transfer before
// protocol-specific specs). `registerClassifierSpecs` lets new protocols be
// added without editing the core — call it before constructing a
// TraceClassifier (ADR-010: keep new-protocol integration to one file + ABI).
import type { Classifier, ClassifierSpec, DecodedCallTrace, Protocol } from "../types.js";
import { AAVE_CLASSIFIER_SPECS } from "./specs/aave.js";
import { BALANCER_CLASSIFIER_SPECS } from "./specs/balancer.js";
import { BANCOR_CLASSIFIER_SPECS } from "./specs/bancor.js";
import { COMPOUND_CLASSIFIER_SPECS } from "./specs/compound.js";
import { CREAM_CLASSIFIER_SPECS } from "./specs/cream.js";
import { CURVE_CLASSIFIER_SPECS } from "./specs/curve.js";
import { ERC20_CLASSIFIER_SPECS } from "./specs/erc20.js";
import { MODERN_CLASSIFIER_SPECS } from "./specs/modern.js";
import { OPENSEA_CLASSIFIER_SPECS } from "./specs/opensea.js";
import { UNISWAP_CLASSIFIER_SPECS } from "./specs/uniswap.js";
import { WETH_CLASSIFIER_SPECS } from "./specs/weth.js";
import { ZEROX_CLASSIFIER_SPECS } from "./specs/zeroEx.js";

// Order matters — mirrors ALL_CLASSIFIER_SPECS in mev-inspect-py (ERC20 first,
// so any contract's transfer/transferFrom is caught before protocol specs).
// cryptopunks is intentionally dropped (ADR-010). Modern protocols (Phase 2b)
// are appended after the legacy set.
let allSpecs: ClassifierSpec[] = [
  ...ERC20_CLASSIFIER_SPECS,
  ...WETH_CLASSIFIER_SPECS,
  ...CURVE_CLASSIFIER_SPECS,
  ...UNISWAP_CLASSIFIER_SPECS,
  ...AAVE_CLASSIFIER_SPECS,
  ...ZEROX_CLASSIFIER_SPECS,
  ...BALANCER_CLASSIFIER_SPECS,
  ...COMPOUND_CLASSIFIER_SPECS,
  ...CREAM_CLASSIFIER_SPECS,
  ...OPENSEA_CLASSIFIER_SPECS,
  ...BANCOR_CLASSIFIER_SPECS,
  // Modern majors (Phase 2b) — appended after the legacy set. Best-effort;
  // Aave V3 liquidations are classified, the rest are decode-only for now.
  ...MODERN_CLASSIFIER_SPECS,
];

let specsByKey: Map<string, ClassifierSpec> | null = null;

function keyOf(abiName: string, protocol: Protocol | null | undefined): string {
  return `${abiName}|${protocol ?? ""}`;
}

function index(): Map<string, ClassifierSpec> {
  if (specsByKey === null) {
    specsByKey = new Map();
    for (const spec of allSpecs) specsByKey.set(keyOf(spec.abiName, spec.protocol), spec);
  }
  return specsByKey;
}

export function getSpecs(): ClassifierSpec[] {
  return allSpecs;
}

/** Append new classifier specs (e.g. a newly integrated protocol). */
export function registerClassifierSpecs(specs: ClassifierSpec[]): void {
  allSpecs = [...allSpecs, ...specs];
  specsByKey = null; // rebuild lazily
}

export function getClassifier(trace: DecodedCallTrace): Classifier | null {
  const spec = index().get(keyOf(trace.abiName, trace.protocol));
  if (spec === undefined) return null;
  return spec.classifiers?.[trace.functionSignature] ?? null;
}

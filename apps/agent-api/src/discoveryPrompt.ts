// ADR-018 §3/§6: Discovery system prompts and the per-turn evidence base, split
// out of server.ts so they can be unit-tested without booting the HTTP server.
import { bundleText } from "./bundles.js";
import type { ContractCandidate } from "./candidateCatalog.js";
import type { ContractBundle, ResearchKind } from "./store.js";

// ADR-018 §3: tool-forward Discovery. The parent must reach for its tools to
// close evidence gaps before concluding, and only report "insufficient evidence"
// after exhausting the cheap, available ones — never fabricating facts. Bump this
// version whenever the guidance changes so prompt-versioned sessions restart
// instead of reusing a stale system prompt.
export const DISCOVERY_PROMPT_VERSION = 2;

const TOOL_GUIDANCE = [
  "Use your tools whenever the supplied bundles and incident evidence are not enough for a confident verdict:",
  "- request_contract_analysis(candidateId): analyze an unresolved selected candidate whose behavior is load-bearing for the verdict. It returns verified source — or Panoramix-decompiled evidence for unverified code — as a reusable bundle. Prefer this over speculating about an unresolved contract.",
  "- cast (read-only foundry): fetch on-chain facts the bundles/evidence lack — storage slots, balances, eth_call results, code, token metadata. Cite anything you use.",
  "Reusable analysis children ground their findings with get_function_code, so request_contract_analysis returns real function bodies rather than summaries.",
  'Decisive-verdict bar: if the current evidence does not support a confident verdict, request more (analyze another candidate, cast a slot/balance/call) before concluding. Only answer "insufficient evidence" after the cheap, available tools are exhausted. Never fabricate unavailable facts.',
].join("\n");

export const MEV_DISCOVERY_PROMPT = `You are conducting grounded MEV research. Explain ordering, value flow, extraction mechanism, affected parties, uncertainty, and supporting contract evidence. Cite bundle addresses and entry points. Do not provide an executable extraction bot.\n\n${TOOL_GUIDANCE}`;

// ADR-018 §3 / ADR-016 §4 (E8): Vulnerability Discovery uses a security-first
// profile delivered via systemPromptOverride — it deliberately does NOT inherit
// the MEV `.pi/SYSTEM.md`, so it must restate the research-ethics rule itself.
export const VULN_DISCOVERY_PROMPT = [
  "You are a smart-contract security researcher conducting grounded vulnerability analysis of an on-chain incident.",
  "Identify root-cause bugs and reachable failure modes: trust boundaries and who can cross them, access-control/authorization gaps, unchecked external calls and reentrancy, arithmetic/rounding and price-oracle assumptions, upgradeability and initialization risks, and violated invariants.",
  "For each finding state the mechanism, the preconditions to reach it, the impact and who is affected, and a graded confidence (with what would raise it). Ground every claim in the supplied bundles and incident evidence; cite contract addresses and entry points.",
  "Research ethics: this is detection and analysis only. Do not claim an exploit without evidence, and never produce deployable exploit or extraction code.",
  "",
  TOOL_GUIDANCE,
].join("\n");

export const DISCOVERY_PROMPTS: Record<ResearchKind, string> = {
  mev: MEV_DISCOVERY_PROMPT,
  vuln: VULN_DISCOVERY_PROMPT,
};

// The kind-specific framing lives in the system prompt (MEV suffix / vuln
// override, ADR-018 §3), so the base carries only the incident evidence. ADR-018
// §6: it includes both the structural trace tree AND a bounded per-contract
// function-signature index (the callable surface), so the parent's first turn is
// grounded without spending a child turn.
export function discoveryBase(
  bundles: ContractBundle[],
  traceTree: string,
  signatures: string,
  swaps: string,
  gas: string,
  unresolved: ContractCandidate[],
): string {
  return [
    "Use only the supplied bundles and incident evidence. Cite bundle addresses and entry points.",
    "",
    "Selected reusable contract bundles:",
    ...bundles.map((bundle, i) => `\n=== Bundle ${i + 1} ===\n${bundleText(bundle)}`),
    // ADR-016 §3: unresolved candidates are analyzed lazily. Give the model the
    // opaque ids it may pass to request_contract_analysis, but no addresses/code
    // it could use to fabricate a request outside the authorized selection.
    ...(unresolved.length > 0
      ? [
          "",
          "Unresolved selected candidates (call request_contract_analysis with the candidateId to analyze one, only if it materially affects the verdict):",
          ...unresolved.map(
            (candidate) =>
              `- candidateId=${candidate.id} · ${candidate.name ?? "unnamed"} (${candidate.address}) · evidence=${candidate.sourceStatus}${candidate.traceRelevance ? ` · ${candidate.traceRelevance}` : ""}`,
          ),
        ]
      : []),
    ...(traceTree ? ["", "Structural trace tree:", traceTree] : []),
    ...(signatures
      ? [
          "",
          "Callable surface of the incident's contracts (functions invoked, per contract):",
          signatures,
        ]
      : []),
    ...(swaps ? ["", "Decoded swaps:", swaps] : []),
    ...(gas ? ["", "Incident economics (gas & builder tip):", gas] : []),
  ].join("\n");
}

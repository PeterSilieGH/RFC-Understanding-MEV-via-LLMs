import { createHash } from "node:crypto";
import { formatSignatureList, parseFunctionSignatures } from "./signatures.js";
import type { ContractBundle, ResearchKind } from "./store.js";

export interface BundleContractInput {
  address: string;
  name?: string;
  codehash?: string;
  codeContext: string;
  valueContext?: string;
}

export interface GeneratedBundle {
  kind: ResearchKind;
  role: string;
  entryPoints: string[];
  flowSummary: string;
  notes: string;
}

export function contractCodehash(contract: BundleContractInput): string {
  const supplied = contract.codehash?.toLowerCase();
  if (supplied && /^0x[0-9a-f]{64}$/.test(supplied)) return supplied;
  // Disco's current project response does not expose runtime bytecode. Hashing
  // its verified flattened source is a deterministic code identity and keeps
  // identical deployments reusable until that API exposes the runtime hash.
  const canonicalSource = contract.codeContext.replace(
    /^(Flattened source code of .+?) \([^\n)]*\)(?: on chain [^:\n]+)?:$/gm,
    "$1:",
  );
  return `0x${createHash("sha256").update(canonicalSource).digest("hex")}`;
}

export function estimateTokens(text: string): number {
  // Provider-neutral measured estimate. Code/prose tokenizers vary, so reserve
  // a conservative ~3.5 UTF-8 chars/token instead of pretending exactness.
  return Math.ceil(Buffer.byteLength(text, "utf8") / 3.5);
}

export function bundleText(bundle: ContractBundle): string {
  return [
    `Contract: ${bundle.addresses.join(", ")}`,
    `Role: ${bundle.role}`,
    `Entry points: ${bundle.entryPoints.join(", ") || "none identified"}`,
    `Control/value flow: ${bundle.flowSummary}`,
    `${bundle.kind === "mev" ? "MEV relevance" : "Vulnerability surface"}: ${bundle.notes}`,
  ].join("\n");
}

export function parseGeneratedBundles(
  report: string,
  requested: ResearchKind[],
): GeneratedBundle[] {
  const cleaned = report
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("bundle analysis did not return valid JSON");
  }
  const values = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { bundles?: unknown }).bundles)
      ? (parsed as { bundles: unknown[] }).bundles
      : [];
  const out: GeneratedBundle[] = [];
  for (const value of values) {
    if (typeof value !== "object" || value === null) continue;
    const item = value as Record<string, unknown>;
    if ((item.kind !== "mev" && item.kind !== "vuln") || !requested.includes(item.kind)) continue;
    if (
      typeof item.role !== "string" ||
      typeof item.flowSummary !== "string" ||
      typeof item.notes !== "string"
    )
      continue;
    out.push({
      kind: item.kind,
      role: item.role.trim(),
      entryPoints: Array.isArray(item.entryPoints)
        ? item.entryPoints.filter((x): x is string => typeof x === "string").slice(0, 12)
        : [],
      flowSummary: item.flowSummary.trim(),
      notes: item.notes.trim(),
    });
  }
  const missing = requested.filter((kind) => !out.some((bundle) => bundle.kind === kind));
  if (missing.length > 0) throw new Error(`bundle analysis omitted: ${missing.join(", ")}`);
  return out;
}

export function buildBundlePrompt(
  contract: BundleContractInput,
  kinds: ResearchKind[],
  targetTokens: number,
): string {
  return [
    "Create compact, durable contract-analysis bundles grounded only in the supplied code and state.",
    `Return JSON only: {\"bundles\":[{\"kind\":\"mev|vuln\",\"role\":\"...\",\"entryPoints\":[\"...\"],\"flowSummary\":\"...\",\"notes\":\"...\"}]}.`,
    `Return exactly these kinds in this single response: ${kinds.join(", ")}.`,
    `Keep each bundle under approximately ${targetTokens} tokens. For mev, focus on ordering/value-extraction relevance. For vuln, focus on trust boundaries, authorization, external calls, accounting, upgradeability, and invariant risks. Do not assert unsupported permissions.`,
    `Contract: ${contract.name ?? "unknown"} (${contract.address})`,
    "",
    "Verified-code signature index (use get_function_code for grounded bodies):",
    formatSignatureList(parseFunctionSignatures(contract.codeContext)),
    ...(contract.valueContext ? ["", "Discovered state and ABI:", contract.valueContext] : []),
  ].join("\n");
}

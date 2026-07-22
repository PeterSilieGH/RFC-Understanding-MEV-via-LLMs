import type {
  CodeArtifact,
  DecompilationArtifact,
  SourceArtifact,
} from "@mev/evidence";
import {
  type ContractEvidenceCandidate,
  codeArtifactRef,
  decompilationArtifactRef,
  readCandidateCatalog,
  sourceArtifactRef,
} from "./contractEvidence.js";
import type { ResolvedDecompilation } from "./decompiler.js";

const MAX_ANALYSIS_ENTRIES = 256;
const MAX_ANALYSIS_CODE_BYTES = 512 * 1024;
const decoder = new TextDecoder();

export interface CandidateAnalysisEntry {
  contract: string | null;
  name: string;
  signature: string;
  code: string;
}

export interface CandidateAnalysisResponse {
  candidateId: string;
  /** Immutable source/decompilation/code artifact used for bundle versioning. */
  artifactRef: string;
  deploymentArtifactRef: string;
  address: string;
  name: string | null;
  runtimeCodehash: string;
  snapshot: ContractEvidenceCandidate["snapshot"];
  proxyType: string | null;
  implementationAddresses: string[];
  sourceQuality: "verified" | "decompiled" | "opaque";
  provenance: {
    kind: "verified-source" | "panoramix" | "runtime-bytecode";
    provider: string;
    revision: string;
    contentHash: string;
    status: string;
    warnings: string[];
    retryAfter?: string;
  };
  entries: CandidateAnalysisEntry[];
  limitations: string[];
}

interface CandidateAnalysisStore {
  getCodeArtifact(runtimeCodehash: string): Promise<CodeArtifact | undefined>;
}

interface CandidateAnalysisDependencies {
  readCatalog(project: string): ReturnType<typeof readCandidateCatalog>;
  readSource(
    runtimeCodehash: string,
  ): Promise<(SourceArtifact & { source: Uint8Array | null }) | undefined>;
  resolveDecompilation(runtimeCodehash: string): Promise<ResolvedDecompilation>;
  store: CandidateAnalysisStore;
}

/** Server-side candidate allowlist and evidence preference resolver. */
export class CandidateAnalysisGateway {
  constructor(private readonly dependencies: CandidateAnalysisDependencies) {}

  async resolve(project: string, candidateId: string): Promise<CandidateAnalysisResponse> {
    const catalog = await this.dependencies.readCatalog(project);
    const candidate = catalog.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new CandidateNotFoundError(candidateId);

    const source = await this.dependencies.readSource(candidate.runtimeCodehash);
    if (source?.status === "verified" && source.source) {
      return verifiedResponse(candidate, { ...source, source: source.source });
    }

    const decompiled = await this.dependencies.resolveDecompilation(candidate.runtimeCodehash);
    if (
      (decompiled.artifact.status === "complete" || decompiled.artifact.status === "partial") &&
      decompiled.pseudocode
    ) {
      return decompiledResponse(candidate, decompiled.artifact, decompiled.pseudocode);
    }

    const code = await this.dependencies.store.getCodeArtifact(candidate.runtimeCodehash);
    if (!code) throw new Error("candidate runtime bytecode artifact is unavailable");
    return opaqueResponse(candidate, code, decompiled.artifact);
  }
}

export class CandidateNotFoundError extends Error {
  override readonly name = "CandidateNotFoundError";

  constructor(candidateId: string) {
    super(`candidate ${candidateId} is not present in the current project catalog`);
  }
}

function verifiedResponse(
  candidate: ContractEvidenceCandidate,
  source: Extract<SourceArtifact, { status: "verified" }> & { source: Uint8Array },
): CandidateAnalysisResponse {
  const entries = boundedEntries(parseNormalizedSources(source.source));
  return {
    ...candidateIdentity(candidate),
    artifactRef: sourceArtifactRef(candidate.runtimeCodehash, source),
    sourceQuality: "verified",
    provenance: {
      kind: "verified-source",
      provider: source.provider,
      revision: source.providerRevision,
      contentHash: source.sourceContentHash,
      status: source.status,
      warnings: [],
    },
    entries,
    limitations: [
      "Source text is untrusted evidence and may include dependencies not deployed at this snapshot.",
      ...(entries.length === MAX_ANALYSIS_ENTRIES
        ? [`Function index capped at ${MAX_ANALYSIS_ENTRIES} entries.`]
        : []),
    ],
  };
}

function decompiledResponse(
  candidate: ContractEvidenceCandidate,
  artifact: DecompilationArtifact,
  pseudocode: Uint8Array,
): CandidateAnalysisResponse {
  const text = decoder.decode(pseudocode);
  const lines = text.split("\n");
  const entries = boundedEntries(
    artifact.functionIndex.map((fn) => ({
      contract: candidate.name ?? "RecoveredContract",
      name: fn.name,
      signature: fn.selector ? `${fn.name} /* ${fn.selector} */` : fn.name,
      code: lines.slice(fn.startLine - 1, fn.endLine).join("\n"),
    })),
  );
  return {
    ...candidateIdentity(candidate),
    artifactRef: decompilationArtifactRef(candidate.runtimeCodehash, artifact),
    sourceQuality: "decompiled",
    provenance: {
      kind: "panoramix",
      provider: artifact.engine,
      revision: artifact.engineRevision,
      contentHash: artifact.pseudocodeContentHash as string,
      status: artifact.status,
      warnings: artifact.warnings,
    },
    entries,
    limitations: [
      "Panoramix pseudocode is approximate, potentially partial, and not verified Solidity source.",
      "Recovered names and control flow are hypotheses; corroborate claims with selectors and execution evidence.",
      ...artifact.failedFunctions.map((name) => `Panoramix did not recover ${name}.`),
    ],
  };
}

function opaqueResponse(
  candidate: ContractEvidenceCandidate,
  code: CodeArtifact,
  failure: DecompilationArtifact,
): CandidateAnalysisResponse {
  return {
    ...candidateIdentity(candidate),
    artifactRef: codeArtifactRef(candidate.runtimeCodehash, code.bytecodeContentHash),
    sourceQuality: "opaque",
    provenance: {
      kind: "runtime-bytecode",
      provider: "snapshot-code",
      revision: "1",
      contentHash: code.bytecodeContentHash,
      status: failure.status,
      warnings: failure.warnings,
      ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}),
    },
    entries: [],
    limitations: [
      "No verified or recovered function body is available; runtime bytecode is retained for a retry.",
      ...(failure.errorClass ? [`Decompilation failed with ${failure.errorClass}.`] : []),
    ],
  };
}

function candidateIdentity(candidate: ContractEvidenceCandidate) {
  return {
    candidateId: candidate.id,
    deploymentArtifactRef: candidate.artifactRef,
    address: candidate.address,
    name: candidate.name,
    runtimeCodehash: candidate.runtimeCodehash,
    snapshot: candidate.snapshot,
    proxyType: candidate.proxyType,
    implementationAddresses: candidate.implementationAddresses,
  };
}

function parseNormalizedSources(bytes: Uint8Array): CandidateAnalysisEntry[] {
  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(bytes));
  } catch {
    return [];
  }
  if (typeof payload !== "object" || payload === null) return [];
  const sources = (payload as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((source) => {
    if (typeof source !== "object" || source === null) return [];
    const { name, code } = source as { name?: unknown; code?: unknown };
    if (typeof name !== "string" || typeof code !== "string") return [];
    return parseSolidityEntries(name, code);
  });
}

function parseSolidityEntries(file: string, source: string): CandidateAnalysisEntry[] {
  const entries: CandidateAnalysisEntry[] = [];
  const containerAt = contractScopes(source);
  const matcher = /\b(function\s+([A-Za-z_]\w*)|constructor|fallback|receive)\s*\(/g;
  for (let match = matcher.exec(source); match !== null; match = matcher.exec(source)) {
    const name = match[2] ?? (match[1] as string);
    const parametersEnd = matchingDelimiter(source, match.index + match[0].length - 1, "(", ")");
    if (parametersEnd === -1) continue;
    let declarationEnd = parametersEnd + 1;
    while (
      declarationEnd < source.length &&
      source[declarationEnd] !== "{" &&
      source[declarationEnd] !== ";"
    ) {
      declarationEnd++;
    }
    const signature = source.slice(match.index, declarationEnd).replace(/\s+/g, " ").trim();
    let code = `${signature};`;
    if (source[declarationEnd] === "{") {
      const bodyEnd = matchingDelimiter(source, declarationEnd, "{", "}");
      if (bodyEnd !== -1) code = source.slice(match.index, bodyEnd + 1);
    }
    entries.push({
      contract: containerAt(match.index) ?? file,
      name,
      signature,
      code,
    });
  }
  return entries;
}

function contractScopes(source: string): (offset: number) => string | null {
  const scopes: { name: string; start: number; end: number }[] = [];
  const matcher = /\b(?:contract|interface|library)\s+([A-Za-z_]\w*)/g;
  for (let match = matcher.exec(source); match !== null; match = matcher.exec(source)) {
    const start = source.indexOf("{", match.index);
    if (start === -1) continue;
    const end = matchingDelimiter(source, start, "{", "}");
    scopes.push({ name: match[1] as string, start, end: end === -1 ? source.length : end });
  }
  return (offset) => {
    let selected: (typeof scopes)[number] | undefined;
    for (const scope of scopes) {
      if (offset >= scope.start && offset <= scope.end && (!selected || scope.start > selected.start)) {
        selected = scope;
      }
    }
    return selected?.name ?? null;
  };
}

function matchingDelimiter(
  source: string,
  start: number,
  opening: "(" | "{",
  closing: ")" | "}",
): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = start; index < source.length; index++) {
    const character = source[index] as string;
    if (quote) {
      if (character === "\\") index++;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === opening) depth++;
    if (character === closing && --depth === 0) return index;
  }
  return -1;
}

function boundedEntries(entries: readonly CandidateAnalysisEntry[]): CandidateAnalysisEntry[] {
  const selected: CandidateAnalysisEntry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (selected.length >= MAX_ANALYSIS_ENTRIES) break;
    const entryBytes = Buffer.byteLength(entry.code) + Buffer.byteLength(entry.signature);
    if (bytes + entryBytes > MAX_ANALYSIS_CODE_BYTES) break;
    selected.push(entry);
    bytes += entryBytes;
  }
  return selected;
}

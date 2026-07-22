import { loadConfig } from "@mev/config";
import type { ResearchKind } from "./store.js";

const config = loadConfig();
const MAX_CANDIDATES = 512;
const CATALOG_TTL_MS = 60 * 60 * 1_000;
const MAX_CATALOGS = 64;

export interface IncidentSnapshot {
  blockNumber: number;
  blockHash: string;
  timestamp: number;
}

export type CandidateSourceStatus =
  | "verified"
  | "decompiled"
  | "opaque"
  | "unverified"
  | "error"
  | "unresolved";

export interface ContractCandidate {
  id: string;
  artifactRef: string;
  analysisArtifactRef?: string;
  address: string;
  name: string | null;
  runtimeCodehash: string;
  sourceStatus: CandidateSourceStatus;
  proxyType: string | null;
  implementationAddresses: string[];
  snapshot: IncidentSnapshot;
  traceRelevance?: string | null;
}

export interface CandidateCatalog {
  project: string;
  fingerprint: string;
  snapshot: IncidentSnapshot;
  candidates: ContractCandidate[];
}

interface CatalogRecord {
  catalog: CandidateCatalog;
  expiresAt: number;
}

const catalogs = new Map<string, CatalogRecord>();

export async function loadCandidateCatalog(project: string): Promise<CandidateCatalog> {
  const response = await fetch(
    `http://localhost:${config.TRACE_API_PORT}/internal/evidence/projects/${encodeURIComponent(project)}/catalog`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`contract evidence catalog unavailable (${response.status}): ${message.slice(0, 500)}`);
  }
  const catalog = parseCatalog(project, await response.json());
  catalogs.set(catalogKey(project, catalog.fingerprint), {
    catalog,
    expiresAt: Date.now() + CATALOG_TTL_MS,
  });
  pruneCatalogs();
  return catalog;
}

export async function authorizeCandidates(input: {
  project: string;
  fingerprint: string;
  kind: ResearchKind;
  candidateIds: string[];
}): Promise<{ catalog: CandidateCatalog; candidates: ContractCandidate[] }> {
  const key = catalogKey(input.project, input.fingerprint);
  let record = catalogs.get(key);
  if (!record || record.expiresAt <= Date.now()) {
    const refreshed = await loadCandidateCatalog(input.project);
    if (refreshed.fingerprint !== input.fingerprint) {
      throw new Error("candidate catalog changed; reopen selection before Discover");
    }
    record = catalogs.get(key);
  }
  if (!record) throw new Error("candidate catalog is unavailable");
  const byId = new Map(record.catalog.candidates.map((candidate) => [candidate.id, candidate]));
  const selected = [...new Set(input.candidateIds)].map((id) => {
    const candidate = byId.get(id);
    if (!candidate) throw new Error(`candidate is not authorized by this catalog: ${id}`);
    return candidate;
  });
  return { catalog: record.catalog, candidates: selected };
}

function parseCatalog(project: string, value: unknown): CandidateCatalog {
  if (!isRecord(value)) throw new Error("contract evidence catalog was not an object");
  const fingerprint = stringField(value, "fingerprint", /^[0-9a-f]{64}$/);
  const snapshot = parseSnapshot(value.snapshot);
  if (!Array.isArray(value.candidates) || value.candidates.length > MAX_CANDIDATES) {
    throw new Error(`contract evidence catalog must contain at most ${MAX_CANDIDATES} candidates`);
  }
  const ids = new Set<string>();
  const candidates = value.candidates.map((candidate) => {
    if (!isRecord(candidate)) throw new Error("catalog candidate was not an object");
    const id = stringField(candidate, "id", /^[0-9a-f]{24,64}$/);
    if (ids.has(id)) throw new Error(`duplicate catalog candidate id: ${id}`);
    ids.add(id);
    const candidateSnapshot = parseSnapshot(candidate.snapshot);
    if (
      candidateSnapshot.blockHash !== snapshot.blockHash ||
      candidateSnapshot.blockNumber !== snapshot.blockNumber
    ) {
      throw new Error(`candidate ${id} belongs to a different incident snapshot`);
    }
    const sourceStatus = stringField(
      candidate,
      "sourceStatus",
      /^(verified|decompiled|opaque|unverified|error|unresolved)$/,
    ) as CandidateSourceStatus;
    return {
      id,
      artifactRef: stringField(candidate, "artifactRef", /^.{1,500}$/),
      analysisArtifactRef:
        typeof candidate.analysisArtifactRef === "string" &&
        candidate.analysisArtifactRef.length <= 500
          ? candidate.analysisArtifactRef
          : undefined,
      address: stringField(candidate, "address", /^0x[0-9a-f]{40}$/),
      name: nullableString(candidate.name),
      runtimeCodehash: stringField(candidate, "runtimeCodehash", /^0x[0-9a-f]{64}$/),
      sourceStatus,
      proxyType: nullableString(candidate.proxyType),
      implementationAddresses: addressList(candidate.implementationAddresses),
      snapshot: candidateSnapshot,
      traceRelevance: nullableString(candidate.traceRelevance),
    } satisfies ContractCandidate;
  });
  return { project, fingerprint, snapshot, candidates };
}

function parseSnapshot(value: unknown): IncidentSnapshot {
  if (!isRecord(value)) throw new Error("catalog snapshot was not an object");
  if (!Number.isSafeInteger(value.blockNumber) || (value.blockNumber as number) < 0) {
    throw new Error("catalog snapshot block number was invalid");
  }
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) < 0) {
    throw new Error("catalog snapshot timestamp was invalid");
  }
  return {
    blockNumber: value.blockNumber as number,
    blockHash: stringField(value, "blockHash", /^0x[0-9a-f]{64}$/),
    timestamp: value.timestamp as number,
  };
}

function catalogKey(project: string, fingerprint: string): string {
  return `${project}:${fingerprint}`;
}

function pruneCatalogs(): void {
  const now = Date.now();
  for (const [key, value] of catalogs) {
    if (value.expiresAt <= now) catalogs.delete(key);
  }
  while (catalogs.size > MAX_CATALOGS) {
    const oldest = catalogs.keys().next().value as string | undefined;
    if (!oldest) break;
    catalogs.delete(oldest);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  value: Record<string, unknown>,
  field: string,
  pattern: RegExp,
): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || !pattern.test(candidate)) {
    throw new Error(`catalog ${field} was invalid`);
  }
  return candidate;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length <= 500 ? value : null;
}

function addressList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (address): address is string =>
          typeof address === "string" && /^0x[0-9a-f]{40}$/.test(address),
      ),
    ),
  ];
}

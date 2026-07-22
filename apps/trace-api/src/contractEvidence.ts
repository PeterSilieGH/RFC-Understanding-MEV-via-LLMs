import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { loadConfig } from "@mev/config";
import { PANORAMIX_ENGINE } from "@mev/decompiler-api";
import type { DecompilationArtifact, Snapshot, SourceArtifact } from "@mev/evidence";
import { ethers } from "ethers";
import { DECOMPILER_OPTIONS_HASH } from "./decompiler.js";
import { discoveryRpc, evidenceStore } from "./evidence.js";
import type { WorkspaceSnapshot } from "./workspace.js";

const config = loadConfig();
const SOURCE_PROVIDER = "l2b-discovery";
const SOURCE_REVISION = "18532eacfff59dfa2ff9ea37d128b65c569fef40";
const textEncoder = new TextEncoder();

interface DiscoveredEntry {
  address: string;
  name?: string;
  type?: string;
  proxyType?: string;
  sourceHashes?: string[];
  values?: Record<string, unknown>;
}

interface DiscoveredProject {
  name?: string;
  timestamp?: number;
  entries?: DiscoveredEntry[];
  abis?: Record<string, string[]>;
}

export interface ContractEvidenceCandidate {
  id: string;
  artifactRef: string;
  address: string;
  name: string | null;
  runtimeCodehash: string;
  sourceStatus: "verified" | "unverified" | "error" | "unresolved";
  sourceQuality: "verified" | "decompiled" | "opaque" | "unresolved";
  /** Exact immutable analysis input when one is already available. */
  analysisArtifactRef?: string;
  proxyType: string | null;
  implementationAddresses: string[];
  snapshot: WorkspaceSnapshot;
}

export async function importDiscoveryEvidence(
  project: string,
  snapshot: WorkspaceSnapshot,
): Promise<void> {
  const discovered = await readDiscovered(project);
  if (discovered.timestamp !== snapshot.timestamp) {
    throw new Error("refusing to import discovery output from a different snapshot");
  }
  const evidenceSnapshot = toSnapshot(snapshot);
  const blockTag = `0x${snapshot.blockNumber.toString(16)}`;
  const deployments = new Map<string, string>();

  for (const entry of discovered.entries ?? []) {
    const address = plainAddress(entry.address);
    if (!address || entry.type === "EOA") continue;
    const runtime = await discoveryRpc.send("eth_getCode", [address, blockTag]);
    if (typeof runtime !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(runtime) || runtime === "0x") {
      continue;
    }
    const runtimeCodehash = ethers.keccak256(runtime).toLowerCase();
    await evidenceStore.putCodeArtifact(runtimeCodehash, ethers.getBytes(runtime));
    await evidenceStore.putDeployment({
      ...evidenceSnapshot,
      address,
      runtimeCodehash,
      producer: SOURCE_PROVIDER,
      schemaVersion: 1,
      completeness: "complete",
      observedAt: new Date().toISOString(),
    });
    deployments.set(address, runtimeCodehash);

    if (entry.type === "Unverified") {
      await evidenceStore.putSourceArtifact({
        runtimeCodehash,
        provider: SOURCE_PROVIDER,
        providerRevision: SOURCE_REVISION,
        status: "unverified",
        metadata: sourceMetadata(project, entry),
        errorClass: "unverified",
        retryAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      continue;
    }
    try {
      const response = await fetch(
        `http://localhost:${config.DISCO_API_PORT}/api/projects/${encodeURIComponent(project)}/code/${encodeURIComponent(entry.address)}`,
      );
      if (!response.ok) throw new Error(`disco-api code endpoint returned ${response.status}`);
      const source = (await response.json()) as {
        entryName?: string;
        sources?: { name: string; code: string }[];
      };
      if (!Array.isArray(source.sources) || source.sources.length === 0) {
        throw new Error("discovery returned no flattened source");
      }
      const normalized = `${JSON.stringify(
        { entryName: source.entryName ?? entry.name ?? null, sources: source.sources },
        null,
        2,
      )}\n`;
      await evidenceStore.putSourceArtifact({
        runtimeCodehash,
        provider: SOURCE_PROVIDER,
        providerRevision: SOURCE_REVISION,
        status: "verified",
        source: textEncoder.encode(normalized),
        mediaType: "application/vnd.mev.normalized-sources+json",
        abi: discovered.abis?.[entry.address] ?? null,
        metadata: sourceMetadata(project, entry),
      });
    } catch (error) {
      await evidenceStore.putSourceArtifact({
        runtimeCodehash,
        provider: SOURCE_PROVIDER,
        providerRevision: SOURCE_REVISION,
        status: "error",
        metadata: sourceMetadata(project, entry),
        errorClass: "source-import",
        retryAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      console.warn(`source import failed for ${address}: ${(error as Error).message}`);
    }
  }

  for (const entry of discovered.entries ?? []) {
    const fromAddress = plainAddress(entry.address);
    if (!fromAddress || !deployments.has(fromAddress)) continue;
    for (const toAddress of implementationAddresses(entry.values?.$implementation)) {
      await evidenceStore.putContractRelation({
        ...evidenceSnapshot,
        fromAddress,
        toAddress,
        relationKind: "implementation",
        producer: SOURCE_PROVIDER,
        metadata: { project },
        observedAt: new Date().toISOString(),
      });
    }
  }
}

export async function readCandidateCatalog(project: string): Promise<{
  snapshot: WorkspaceSnapshot;
  fingerprint: string;
  candidates: ContractEvidenceCandidate[];
}> {
  const snapshot = await readSnapshot(project);
  const discovered = await readDiscovered(project);
  if (discovered.timestamp !== snapshot.timestamp) throw new Error("project snapshot is stale");
  const evidenceSnapshot = toSnapshot(snapshot);
  const candidates: ContractEvidenceCandidate[] = [];
  for (const entry of discovered.entries ?? []) {
    const address = plainAddress(entry.address);
    if (!address || entry.type === "EOA") continue;
    const deployment = await evidenceStore.getDeployment(evidenceSnapshot, address);
    if (!deployment) continue;
    const source = await evidenceStore.getSourceArtifact(
      deployment.runtimeCodehash,
      SOURCE_PROVIDER,
      SOURCE_REVISION,
    );
    const decompilation = await evidenceStore.getDecompilationArtifact(
      deployment.runtimeCodehash,
      PANORAMIX_ENGINE.name,
      PANORAMIX_ENGINE.revision,
      DECOMPILER_OPTIONS_HASH,
    );
    const cachedAnalysis = analysisCacheIdentity(source, decompilation);
    candidates.push({
      id: candidateId(project, snapshot.blockHash, address, deployment.runtimeCodehash),
      artifactRef: `deployment:1:${snapshot.blockHash}:${address}`,
      address,
      name: entry.name ?? null,
      runtimeCodehash: deployment.runtimeCodehash,
      sourceStatus: source?.status ?? "unresolved",
      sourceQuality: cachedAnalysis.sourceQuality,
      ...(cachedAnalysis.analysisArtifactRef
        ? { analysisArtifactRef: cachedAnalysis.analysisArtifactRef }
        : {}),
      proxyType: entry.proxyType ?? null,
      implementationAddresses: implementationAddresses(entry.values?.$implementation),
      snapshot,
    });
  }
  candidates.sort((left, right) => left.address.localeCompare(right.address));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        candidates.map((candidate) => [
          candidate.id,
          candidate.runtimeCodehash,
          candidate.sourceStatus,
          candidate.sourceQuality,
          candidate.analysisArtifactRef ?? null,
        ]),
      ),
    )
    .digest("hex");
  return { snapshot, fingerprint, candidates };
}

export async function getNormalizedSource(runtimeCodehash: string) {
  return evidenceStore.getSourceArtifact(runtimeCodehash, SOURCE_PROVIDER, SOURCE_REVISION);
}

export const discoverySourceIdentity = {
  provider: SOURCE_PROVIDER,
  revision: SOURCE_REVISION,
} as const;

export function sourceArtifactRef(
  runtimeCodehash: string,
  source: Pick<SourceArtifact, "provider" | "providerRevision" | "sourceContentHash">,
): string {
  return [
    "source",
    "1",
    runtimeCodehash,
    source.provider,
    source.providerRevision,
    source.sourceContentHash,
  ].join(":");
}

export function decompilationArtifactRef(
  runtimeCodehash: string,
  artifact: Pick<
    DecompilationArtifact,
    "engine" | "engineRevision" | "optionsHash" | "pseudocodeContentHash"
  >,
): string {
  return [
    "decompilation",
    "1",
    runtimeCodehash,
    artifact.engine,
    artifact.engineRevision,
    artifact.optionsHash,
    artifact.pseudocodeContentHash,
  ].join(":");
}

export function codeArtifactRef(runtimeCodehash: string, contentHash: string): string {
  return ["code", "1", runtimeCodehash, contentHash].join(":");
}

function analysisCacheIdentity(
  source:
    | (SourceArtifact & { source: Uint8Array | null })
    | undefined,
  decompilation:
    | (DecompilationArtifact & { pseudocode: Uint8Array | null })
    | undefined,
): Pick<ContractEvidenceCandidate, "sourceQuality" | "analysisArtifactRef"> {
  if (source?.status === "verified" && source.sourceContentHash) {
    return {
      sourceQuality: "verified",
      analysisArtifactRef: sourceArtifactRef(source.runtimeCodehash, source),
    };
  }
  if (
    decompilation &&
    (decompilation.status === "complete" || decompilation.status === "partial") &&
    decompilation.pseudocodeContentHash
  ) {
    return {
      sourceQuality: "decompiled",
      analysisArtifactRef: decompilationArtifactRef(decompilation.runtimeCodehash, decompilation),
    };
  }
  if (
    decompilation &&
    decompilation.retryAfter !== null &&
    new Date(decompilation.retryAfter).getTime() > Date.now()
  ) {
    return { sourceQuality: "opaque" };
  }
  return { sourceQuality: "unresolved" };
}

function sourceMetadata(project: string, entry: DiscoveredEntry): Record<string, unknown> {
  return {
    project,
    address: entry.address,
    name: entry.name ?? null,
    sourceHashes: entry.sourceHashes ?? [],
    proxyType: entry.proxyType ?? null,
  };
}

function plainAddress(value: string): string | undefined {
  const plain = value.replace(/^[a-z0-9-]+:/i, "").toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(plain) ? plain : undefined;
}

function implementationAddresses(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(values.flatMap((item) => (typeof item === "string" ? [plainAddress(item)] : [])).filter((item): item is string => item !== undefined))];
}

function candidateId(
  project: string,
  blockHash: string,
  address: string,
  runtimeCodehash: string,
): string {
  return createHash("sha256")
    .update(`${project}:${blockHash}:${address}:${runtimeCodehash}`)
    .digest("hex")
    .slice(0, 24);
}

function toSnapshot(snapshot: WorkspaceSnapshot): Snapshot {
  return {
    chainId: "1",
    blockNumber: String(snapshot.blockNumber),
    blockHash: snapshot.blockHash,
  };
}

async function readSnapshot(project: string): Promise<WorkspaceSnapshot> {
  const raw = await readProjectFile(project, "evidence-snapshot.json");
  const value = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
  if (
    !Number.isSafeInteger(value.blockNumber) ||
    !Number.isSafeInteger(value.timestamp) ||
    typeof value.blockHash !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(value.blockHash)
  ) {
    throw new Error("project has no valid incident snapshot evidence");
  }
  return value as WorkspaceSnapshot;
}

async function readDiscovered(project: string): Promise<DiscoveredProject> {
  return JSON.parse(await readProjectFile(project, "discovered.json")) as DiscoveredProject;
}

async function readProjectFile(project: string, name: string): Promise<string> {
  if (!/^trace-[0-9a-f]{8}$/.test(project)) throw new Error("invalid synthetic project name");
  const root = resolve(config.DISCOVERY_PROJECTS_DIR);
  const path = resolve(root, project, name);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("project path escaped discovery root");
  return readFile(path, "utf8");
}

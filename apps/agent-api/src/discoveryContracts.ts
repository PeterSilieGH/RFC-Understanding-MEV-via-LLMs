import type { BundleContractInput, BundleContractRef } from "./bundles.js";

interface DiscoverySource {
  name: string;
  code: string;
}

interface DiscoveryField {
  name: string;
  value: unknown;
}

interface DiscoveryAbiEntry {
  value: string;
  signature?: string;
  topic?: string;
}

interface DiscoveryContract {
  address: string;
  name?: string;
  type?: string;
  chain: string;
  fields?: DiscoveryField[];
  abis?: { entries: DiscoveryAbiEntry[] }[];
}

interface DiscoveryProject {
  entries?: {
    blockNumbers?: Record<string, number>;
    initialContracts?: DiscoveryContract[];
    discoveredContracts?: DiscoveryContract[];
  }[];
}

type Fetch = typeof fetch;

export class UnverifiedContractError extends Error {
  constructor(
    readonly address: string,
    readonly contractName?: string,
  ) {
    super(`Discovery marks ${address} as unverified; verified source is unavailable`);
    this.name = "UnverifiedContractError";
  }
}

/**
 * Request-scoped loader for Discovery-owned contract material. The project
 * metadata request is shared, while flattened source is fetched separately for
 * each missing codehash. Browser requests therefore carry identities only.
 */
export class DiscoveryContractLoader {
  private projectData: Promise<DiscoveryProject> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly project: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async load(ref: BundleContractRef): Promise<BundleContractInput> {
    const project = await this.fetchProject();
    const match = findContract(project, ref.address);
    // l2b answers /code/ with HTTP 500 for explicitly unverified contracts.
    // Treat that metadata as a supported opaque input instead of issuing a
    // source request that can never succeed on every preparation retry.
    if (match?.contract.type === "Unverified") {
      throw new UnverifiedContractError(
        ref.address,
        ref.name ?? (match.contract.name || undefined),
      );
    }
    const code = await this.fetchCode(ref.address);
    if (code.sources.length === 0) {
      throw new Error(`no verified contract source is available for ${ref.address}`);
    }
    return {
      ...ref,
      name: ref.name ?? match?.contract.name ?? code.entryName,
      codeContext: formatCodeContext(ref.address, code.sources),
      valueContext: match
        ? formatValueContext(match.contract, match.blockNumber) || undefined
        : undefined,
    };
  }

  private async fetchCode(
    address: string,
  ): Promise<{ entryName?: string; sources: DiscoverySource[] }> {
    return this.getJson(
      `/api/projects/${encodeURIComponent(this.project)}/code/${encodeURIComponent(address)}`,
    );
  }

  private fetchProject(): Promise<DiscoveryProject> {
    this.projectData ??= this.getJson(`/api/projects/${encodeURIComponent(this.project)}`);
    return this.projectData;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`disco-api ${path} failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}

function formatCodeContext(address: string, sources: DiscoverySource[]): string {
  const chain = address.includes(":") ? address.split(":")[0] : undefined;
  const parts: string[] = [];
  for (const source of sources) {
    let header = `Flattened source code of ${source.name} (${address})`;
    if (chain) header += ` on chain ${chain}`;
    parts.push(`\n${header}:`, "```", source.code, "```");
  }
  return parts.join("\n");
}

function findContract(
  project: DiscoveryProject,
  address: string,
): { contract: DiscoveryContract; blockNumber?: number } | undefined {
  for (const entry of project.entries ?? []) {
    for (const contract of [
      ...(entry.initialContracts ?? []),
      ...(entry.discoveredContracts ?? []),
    ]) {
      if (contract.address.toLowerCase() !== address.toLowerCase()) continue;
      return { contract, blockNumber: entry.blockNumbers?.[contract.chain] };
    }
  }
  return undefined;
}

function formatValueContext(contract: DiscoveryContract, blockNumber?: number): string {
  const parts: string[] = [];
  if (contract.fields && contract.fields.length > 0) {
    let header = "Contract state from public functions and event handlers";
    if (blockNumber !== undefined && contract.chain) {
      header += ` for block number ${blockNumber} on chain ${contract.chain}`;
    }
    header += ` (${contract.address})`;
    parts.push(`\n${header}:`, "```");
    for (const field of contract.fields)
      parts.push(`${field.name}: ${JSON.stringify(field.value)}`);
    parts.push("```");
  }
  if (contract.abis && contract.abis.length > 0) {
    let header = `Contract ABI for ${contract.address}`;
    if (contract.chain) header += ` on chain ${contract.chain}`;
    parts.push(`\n${header}:`, "```");
    for (const abi of contract.abis) {
      for (const entry of abi.entries) {
        let line = entry.value;
        if (entry.signature) line += ` //${entry.signature}`;
        else if (entry.value.startsWith("event") && entry.topic) line += ` //${entry.topic}`;
        parts.push(line);
      }
    }
    parts.push("```");
  }
  return parts.join("\n");
}

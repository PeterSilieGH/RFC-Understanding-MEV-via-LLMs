// Contract-source fetching, following the DiscoUI readonly-mode pattern
// (l2beat@18532eac packages/discovery/src/utils/EtherscanClient.ts, ADR-004):
// contract/getsourcecode returns either a plain source string, a JSON map of
// files, or a double-brace-wrapped standard-json-input whose .sources holds
// the files. All three shapes are normalized to { name -> code }.
import { loadConfig } from "@mev/config";
import { z } from "zod";

const config = loadConfig();

const CACHE_TTL_MS = 10 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 30 * 1000;

export interface ContractSources {
  verified: boolean;
  name: string | null;
  compilerVersion: string | null;
  isProxy: boolean;
  implementation: string | null;
  abi: unknown[] | null;
  sources: { name: string; code: string }[];
}

const sourceResult = z.object({
  status: z.string(),
  result: z
    .array(
      z.object({
        SourceCode: z.string(),
        ABI: z.string(),
        ContractName: z.string(),
        CompilerVersion: z.string(),
        Proxy: z.string().optional(),
        Implementation: z.string().optional(),
      }),
    )
    .or(z.string()),
});

function parseSourceCode(raw: string, contractName: string): { name: string; code: string }[] {
  if (raw === "") return [];
  // standard-json-input arrives wrapped in an extra pair of braces
  if (raw.startsWith("{{")) {
    try {
      const standardJson = JSON.parse(raw.slice(1, -1)) as {
        sources?: Record<string, { content?: string }>;
      };
      return Object.entries(standardJson.sources ?? {}).map(([name, file]) => ({
        name,
        code: file.content ?? "",
      }));
    } catch {
      return [{ name: `${contractName}.sol`, code: raw }];
    }
  }
  if (raw.startsWith("{")) {
    try {
      const files = JSON.parse(raw) as Record<string, { content?: string } | string>;
      return Object.entries(files).map(([name, file]) => ({
        name,
        code: typeof file === "string" ? file : (file.content ?? ""),
      }));
    } catch {
      return [{ name: `${contractName}.sol`, code: raw }];
    }
  }
  return [{ name: `${contractName || "Contract"}.sol`, code: raw }];
}

const cache = new Map<string, { value: ContractSources | null; fetchedAt: number }>();

export async function getContractSources(address: string): Promise<ContractSources | null> {
  const cached = cache.get(address);
  if (cached) {
    const ttl = cached.value === null ? FAILURE_CACHE_TTL_MS : CACHE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) return cached.value;
  }

  const value = await fetchContractSources(address);
  cache.set(address, { value, fetchedAt: Date.now() });
  return value;
}

async function fetchContractSources(address: string): Promise<ContractSources | null> {
  if (!config.ETHERSCAN_API_KEY) return null;
  const url = `https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getsourcecode&address=${address}&apikey=${config.ETHERSCAN_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const parsed = sourceResult.parse(await res.json());
    if (parsed.status !== "1" || typeof parsed.result === "string") return null;
    const entry = parsed.result[0];
    if (!entry) return null;

    const verified = entry.SourceCode !== "";
    let abi: unknown[] | null = null;
    try {
      abi = verified ? (JSON.parse(entry.ABI) as unknown[]) : null;
    } catch {
      abi = null;
    }

    return {
      verified,
      name: entry.ContractName || null,
      compilerVersion: verified ? entry.CompilerVersion : null,
      isProxy: entry.Proxy === "1",
      implementation:
        entry.Implementation && entry.Implementation !== ""
          ? entry.Implementation.toLowerCase()
          : null,
      abi,
      sources: parseSourceCode(entry.SourceCode, entry.ContractName),
    };
  } catch {
    return null;
  }
}

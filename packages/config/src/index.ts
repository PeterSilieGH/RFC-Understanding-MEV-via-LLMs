import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as dotenv from "dotenv";
import { z } from "zod";

const configSchema = z.object({
  RPC_URL: z.string().url().default("http://localhost:8504"),

  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_USER: z.string().default("postgres"),
  POSTGRES_PASSWORD: z.string().default("password"),
  POSTGRES_DB: z.string().default("mev_inspect"),

  EXPLORER_API_PORT: z.coerce.number().int().default(3000),
  TRACE_API_PORT: z.coerce.number().int().default(2022),
  AGENT_API_PORT: z.coerce.number().int().default(3100),
  AGENT_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  DISCO_API_PORT: z.coerce.number().int().default(2021),

  // Where synthetic trace-<hash8> discovery projects are written (ADR-008).
  // In compose this is a bind mount of the submodule's projects dir, so
  // configs land on the host as untracked files, same as UI-created projects.
  DISCOVERY_PROJECTS_DIR: z.string().default("l2beat/packages/config/src/projects"),

  // Per-block budget for the in-process native inspector (ADR-010): a degraded
  // RPC node can leave a block's trace fetch hanging, so each block is bounded.
  INSPECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .default(5 * 60 * 1000),

  // When true, explorer-api continuously inspects new blocks as the chain
  // advances (in addition to the on-demand + backfill paths). Off by default.
  // NB: parsed as a string, not z.coerce.boolean() — the latter turns the
  // literal string "false" into `true` (Boolean("false") === true).
  INSPECTOR_FOLLOW_HEAD: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  // Exhaustive-coverage floor (ADR-011 §1): the canonical corpus is
  // [INSPECT_FLOOR_BLOCK … head]. Ethereum block 11,000,000 (~Oct 2020) is the
  // first block from which the ported detectors and DEX/token registries are
  // meaningful.
  INSPECT_FLOOR_BLOCK: z.coerce.number().int().default(11_000_000),

  // When true, explorer-api runs the continuous fixed-range inspection worker
  // (ADR-011 §1, X10): a service-lifecycle backfill that keeps
  // [INSPECT_FLOOR_BLOCK … head] filled. Off by default so a fresh checkout
  // doesn't start a multi-week fill unasked. Same string-parse caveat as
  // INSPECTOR_FOLLOW_HEAD.
  INSPECTOR_FILL_RANGE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ETHERSCAN_API_KEY: z.string().optional(),
  COINGECKO_API_KEY: z.string().optional(),

  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof configSchema>;

/** Walks up from cwd to find the repo-root .env (the single config source). */
function findRootEnv(): string | undefined {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  const envPath = findRootEnv();
  if (envPath) dotenv.config({ path: envPath });
  cached = configSchema.parse(process.env);
  return cached;
}

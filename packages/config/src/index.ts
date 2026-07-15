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
  DISCO_API_PORT: z.coerce.number().int().default(2021),

  // Where synthetic trace-<hash8> discovery projects are written (ADR-008).
  // In compose this is a bind mount of the submodule's projects dir, so
  // configs land on the host as untracked files, same as UI-created projects.
  DISCOVERY_PROJECTS_DIR: z.string().default("l2beat/packages/config/src/projects"),

  MEV_INSPECT_IMAGE: z.string().default("mev-inspect-py:local"),
  // A hanging RPC node leaves inspect containers running forever otherwise
  INSPECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .default(5 * 60 * 1000),

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

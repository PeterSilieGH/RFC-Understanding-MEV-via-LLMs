import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import { logger } from "./logger.js";
import { readFileSync } from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TunnelConfig {
  /** Friendly name: "ethereum", "optimism", "base", … */
  name: string;
  /** SSH host alias (from ~/.ssh/config or a hostname) */
  sshHost: string;
  /** Remote RPC port on the SSH host */
  remotePort: number;
  /** Local port to bind (defaults to 8545 + chain offset) */
  localPort?: number;
  /** Keep-alive interval in seconds (default 30) */
  keepalive?: number;
}

export interface Tunnel {
  name: string;
  localPort: number;
  localUrl: string;
  wsUrl?: string;
  pid: number;
}

// ─── Pre-defined tunnel configs ───────────────────────────────────────────────

/** Tunnel configs for well-known DSN nodes. Override via SSH_TUNNELS env or CLI. */
export const DEFAULT_TUNNELS: TunnelConfig[] = [
  {
    name: "ethereum",
    sshHost: "dsn-rfc",
    remotePort: 8545,
    localPort: 8545,
    keepalive: 30,
  },
];

// ─── Tunnel manager ────────────────────────────────────────────────────────────

/**
 * Start an SSH tunnel for a given chain config.
 * Returns the local HTTP URL and optionally a WS URL.
 *
 * Requires SSH access to the remote host (key-based auth is recommended).
 */
export function startTunnel(config: TunnelConfig): Tunnel {
  const localPort = config.localPort ?? 8545;
  const sshArgs = [
    "-NT",
    "-o", `ServerAliveInterval=${config.keepalive ?? 30}`,
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `LocalForward=localhost:${localPort} localhost:${config.remotePort}`,
    config.sshHost,
  ];

  logger.info(`[tunnel] Starting: ssh ${sshArgs.join(" ")}`);

  const proc = spawn("ssh", sshArgs, {
    stdio: "ignore",
    detached: true,
    shell: false,
  });

  proc.unref();

  const pid = proc.pid ?? 0;
  logger.info(`[tunnel] PID ${pid} — local port ${localPort}`);

  return {
    name: config.name,
    localPort,
    localUrl: `http://localhost:${localPort}`,
    wsUrl: `ws://localhost:${localPort + 1}`, // convention: +1 for ws
    pid,
  };
}

/**
 * Start a named tunnel from DEFAULT_TUNNELS or SSH_TUNNELS env.
 */
export function startNamedTunnel(name: string): Tunnel | null {
  const fromEnv = process.env.SSH_TUNNELS ?? "";
  const fromEnvMap = Object.fromEntries(
    fromEnv.split(",").filter(Boolean).map((e) => {
      const [n, hp] = e.split("=");
      const [host, port] = hp.split(":");
      return [n, { sshHost: host, remotePort: Number(port) }];
    })
  );

  const preset = DEFAULT_TUNNELS.find((t) => t.name === name);
  const envCfg = fromEnvMap[name];

  if (!preset && !envCfg) {
    logger.error(`[tunnel] No tunnel config for '${name}'. Check DEFAULT_TUNNELS or SSH_TUNNELS.`);
    return null;
  }

  const config: TunnelConfig = {
    name,
    sshHost: (envCfg ?? preset!).sshHost,
    remotePort: (envCfg ?? preset!).remotePort,
    localPort: preset?.localPort ?? 8545,
    keepalive: preset?.keepalive ?? 30,
  };

  return startTunnel(config);
}

/**
 * Kill a tunnel process by PID.
 */
export function stopTunnel(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
    logger.info(`[tunnel] Killed PID ${pid}`);
  } catch (err) {
    logger.warn(`[tunnel] Failed to kill PID ${pid}: ${(err as Error).message}`);
  }
}

/**
 * Start a tunnel and wait for it to be ready by probing the HTTP endpoint.
 */
export async function startTunnelWithHealthCheck(
  config: TunnelConfig,
  timeoutMs = 10_000
): Promise<Tunnel> {
  const tunnel = startTunnel(config);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(tunnel.localUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        signal: AbortSignal.timeout(2_000),
      });
      if (resp.ok) {
        logger.info(`[tunnel] ✓ ${config.name} RPC ready at ${tunnel.localUrl}`);
        return tunnel;
      }
    } catch {
      // not ready yet, retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  stopTunnel(tunnel.pid);
  throw new Error(`Tunnel ${config.name} did not become healthy within ${timeoutMs}ms`);
}

// ─── Env helpers ──────────────────────────────────────────────────────────────

/** Read the current ETHEREUM_RPC_URL from .env without importing dotenv directly */
export function readRpcFromEnv(envPath = resolve(process.cwd(), ".env")): { http?: string; ws?: string } {
  try {
    const raw = readFileSync(envPath, "utf8");
    const lines = raw.split("\n").filter((l) => !l.startsWith("#") && l.includes("="));
    const vars = Object.fromEntries(lines.map((l) => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim()]; }));
    return {
      http: vars.ETHEREUM_RPC_URL || undefined,
      ws:   vars.ETHEREUM_RPC_WS_URL || undefined,
    };
  } catch {
    return {};
  }
}
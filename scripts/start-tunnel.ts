#!/usr/bin/env tsx
/**
 * Quick tunnel starter — wraps scripts/tunnel.sh as a convenient CLI.
 *
 * Usage:
 *   npx tsx scripts/start-tunnel.ts ethereum
 *   npx tsx scripts/start-tunnel.ts --list
 *   npx tsx scripts/start-tunnel.ts ethereum -p 8551
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { spawn } from "child_process";

const FRAMEWORK_ROOT = resolve(dirname(import.meta.filename), "..");

const TUNNELS: Record<string, { sshHost: string; remotePort: number; localPort: number }> = {
  ethereum:  { sshHost: "dsn-rfc", remotePort: 8545, localPort: 8545 },
  optimism:  { sshHost: "dsn-rfc", remotePort: 8546, localPort: 8546 },
  arbitrum:  { sshHost: "dsn-rfc", remotePort: 8547, localPort: 8547 },
  base:      { sshHost: "dsn-rfc", remotePort: 8548, localPort: 8548 },
};

const name = process.argv[2];
const portArg = process.argv.find((a, i) => process.argv[i - 1] === "-p");
const remotePort = portArg ? Number(process.argv[process.argv.indexOf(portArg) + 1]) : undefined;

if (!name || name === "--list" || name === "-h" || name === "--help") {
  console.log("Available tunnels:");
  Object.entries(TUNNELS).forEach(([n, t]) => {
    console.log(`  ${n.padEnd(12)} → ${t.sshHost}:${t.remotePort} (→ localhost:${t.localPort})`);
  });
  console.log("\nOverride via SSH_TUNNELS env: SSH_TUNNELS='arbitrage=my-host:8545' npx tsx scripts/start-tunnel.ts arbitrage");
  process.exit(0);
}

const config = TUNNELS[name];
if (!config) {
  console.error(`Unknown tunnel "${name}". Run with --list to see available tunnels.`);
  process.exit(1);
}

const port = remotePort ?? config.remotePort;
const localPort = config.localPort;

const proc = spawn("ssh", [
  "-NT",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "StrictHostKeyChecking=accept-new",
  "-L", `${localPort}:localhost:${port}`,
  config.sshHost,
], {
  stdio: "inherit",
  shell: false,
});

proc.on("error", (err) => {
  console.error(`SSH tunnel error: ${err.message}`);
  process.exit(1);
});

console.log(`[tunnel] Starting: ${name} → ${config.sshHost}:${port} → localhost:${localPort}`);
console.log(`[tunnel] Once up, set: ETHEREUM_RPC_URL=http://localhost:${localPort}`);
console.log(`[tunnel] WebSocket: ws://localhost:${localPort + 1} (if supported)`);

process.on("SIGINT", () => {
  proc.kill("SIGTERM");
  process.exit(0);
});
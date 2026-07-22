import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import type { Server } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { createApp } from "./app.js";
import { loadDecompilerConfig } from "./config.js";
import { createPanoramixRunner } from "./runner.js";

export function prepareSocketPath(socketPath: string): void {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o750 });
  if (!existsSync(socketPath)) return;
  const existing = lstatSync(socketPath);
  if (!existing.isSocket()) {
    throw new Error(`refusing to replace non-socket path: ${socketPath}`);
  }
  unlinkSync(socketPath);
}

export function startServer(): Server {
  const config = loadDecompilerConfig();
  const logger = pino();
  prepareSocketPath(config.socketPath);
  const app = createApp({ config, runner: createPanoramixRunner(config), logger });
  const server = app.listen(config.socketPath, () => {
    chmodSync(config.socketPath, 0o660);
    logger.info(
      { socketPath: config.socketPath, maxConcurrency: config.maxConcurrency },
      "decompiler-api listening",
    );
  });

  const close = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "shutting down decompiler-api");
    server.close(() => {
      try {
        if (existsSync(config.socketPath) && lstatSync(config.socketPath).isSocket()) {
          unlinkSync(config.socketPath);
        }
      } catch (error) {
        logger.warn({ err: error }, "failed to remove decompiler socket during shutdown");
      }
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => close("SIGTERM"));
  process.once("SIGINT", () => close("SIGINT"));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}

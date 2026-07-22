import express, { type ErrorRequestHandler, type Express } from "express";
import pino, { type Logger } from "pino";
import type { DecompilerConfig } from "./config.js";
import type { PanoramixRunner } from "./runner.js";
import { DecompilerService, requestError } from "./service.js";
import { PANORAMIX_ENGINE } from "./types.js";

export interface AppDependencies {
  config: DecompilerConfig;
  runner: PanoramixRunner;
  logger?: Logger;
}

export function createApp({ config, runner, logger = pino() }: AppDependencies): Express {
  const app = express();
  const service = new DecompilerService(config, runner, logger);

  app.disable("x-powered-by");
  // A runtime contract is at most 24 KiB, so a strict 64 KiB JSON envelope is sufficient.
  app.use(express.json({ limit: "64kb", strict: true }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", engine: PANORAMIX_ENGINE });
  });

  app.post("/api/decompile", async (req, res) => {
    const reply = await service.decompile(req.body);
    for (const [name, value] of Object.entries(reply.headers ?? {})) res.set(name, value);
    res.status(reply.statusCode).json(reply.body);
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      res.status(413).json(
        requestError({
          code: "bytecode_too_large",
          message: "request body exceeds the 64 KiB service limit",
        }),
      );
      return;
    }
    if (error instanceof SyntaxError) {
      res
        .status(400)
        .json(requestError({ code: "invalid_request", message: "request body is not valid JSON" }));
      return;
    }
    logger.error({ err: error }, "request middleware failure");
    res
      .status(500)
      .json(requestError({ code: "internal_error", message: "request processing failed" }));
  };
  app.use(errorHandler);

  return app;
}

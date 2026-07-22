// Monorepo-owned bridge for snapshot-pinned l2b discovery (ADR-016). It runs
// inside the disco-api image so trace-api can request `l2b discover --timestamp`
// without changing the read-only l2beat submodule or exposing a shell command.
"use strict";

const http = require("node:http");
const { spawn } = require("node:child_process");

const port = Number(process.env.DISCOVERY_RUNNER_PORT) || 2023;
const timeoutMs = Number(process.env.DISCOVERY_RUNNER_TIMEOUT_MS) || 5 * 60 * 1000;
const maxBody = 16 * 1024;
const maxOutput = 64 * 1024;
let queue = Promise.resolve();

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, { ok: true });
  }
  if (request.method !== "POST" || request.url !== "/discover") {
    return json(response, 404, { error: "not found" });
  }
  readJson(request)
    .then((body) => validate(body))
    .then((input) => {
      const run = queue.then(() => discover(input));
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    })
    .then(
      (result) => json(response, result.exitCode === 0 ? 200 : 502, result),
      (error) => json(response, 400, { ok: false, error: error.message }),
    );
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[discovery-runner] listening on 127.0.0.1:${port}`);
});

function discover({ project, timestamp }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["/app/packages/l2b/dist/cli.js", "discover", project, "--timestamp", String(timestamp)],
      { cwd: "/app", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-maxOutput);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        exitCode: code ?? -1,
        signal,
        output: output.trim().split("\n").slice(-20).join("\n"),
      });
    });
  });
}

function validate(body) {
  if (!body || typeof body !== "object") throw new Error("JSON object required");
  if (typeof body.project !== "string" || !/^trace-[0-9a-f]{8}$/.test(body.project)) {
    throw new Error("invalid synthetic project name");
  }
  if (!Number.isSafeInteger(body.timestamp) || body.timestamp <= 0) {
    throw new Error("invalid timestamp");
  }
  return { project: body.project, timestamp: body.timestamp };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBody) request.destroy(new Error("request too large"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

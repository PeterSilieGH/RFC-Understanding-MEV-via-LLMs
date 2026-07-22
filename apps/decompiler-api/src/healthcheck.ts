import http from "node:http";
import { loadDecompilerConfig } from "./config.js";

const { socketPath } = loadDecompilerConfig();
const request = http.get({ socketPath, path: "/health", timeout: 2_000 }, (response) => {
  response.resume();
  process.exit(response.statusCode === 200 ? 0 : 1);
});
request.once("timeout", () => request.destroy(new Error("health check timed out")));
request.once("error", () => process.exit(1));

// Preloaded into disco-api via NODE_OPTIONS=--require (docker-compose.yml).
//
// l2beat's discovery fans out RPC requests with unbounded parallelism; with
// keep-alive that opened ~1000 sockets against the shared RPC node, which
// enforces a server-side connection cap and then rejects everyone with
// "Too many connections" (see docs/adr/007 + memory). Both of its HTTP
// paths - node-fetch (JSON-RPC batches) and ethers v5 (provider) - fall
// back to Node's global agents when no explicit agent is given, so bounding
// the global agents bounds every connection the process (and its spawned
// `l2b discover` children, which inherit NODE_OPTIONS) can hold.
"use strict";
const http = require("node:http");
const https = require("node:https");

const max = Number(process.env.RPC_MAX_SOCKETS) || 1000;
const options = {
  keepAlive: true,
  maxSockets: max, // per origin - the RPC tunnel is a single origin
  maxTotalSockets: max, // across all origins, the actual 1k bound
};

http.globalAgent = new http.Agent(options);
https.globalAgent = new https.Agent(options);

// Preloaded into disco-api via NODE_OPTIONS=--require (docker-compose.yml),
// alongside limit-rpc-sockets.cjs.
//
// l2beat's proxy detection reconstructs a proxy's full upgrade history by
// scanning eth_getLogs from the contract's deployment to head in ~100k-block
// chunks (discovery/src/discovery/proxies/pastUpgrades.ts, Eip2535Proxy, …).
// Our shared RPC node has no log index: one idle chunk measured 11.4s, so a
// 19M-block history (USDC) needs ~35 minutes sequentially and times out
// entirely under discovery's parallelism - a trace-workspace run never
// finishes (work package T2, 2026-07-15).
//
// This preload bounds every eth_getLogs to the most recent
// RPC_GETLOGS_MAX_BLOCKS blocks: chunks entirely older than the window
// resolve to [] without touching the node, chunks straddling it are clamped.
// Consequence (documented platform constraint): $pastUpgrades /
// $upgradeCount only reflect upgrades within the window; implementation and
// admin resolution are storage reads and stay fully accurate.
"use strict";
const Module = require("node:module");

const MAX_BLOCKS = Number(process.env.RPC_GETLOGS_MAX_BLOCKS) || 1_000_000;

const patched = new WeakSet();
let headPromise = null;
let announced = false;

function patchSend(JsonRpcProvider) {
  const proto = JsonRpcProvider.prototype;
  if (patched.has(proto) || typeof proto.send !== "function") return;
  patched.add(proto);
  const origSend = proto.send;

  proto.send = function send(method, params) {
    if (method !== "eth_getLogs" || !params || !params[0]) {
      return origSend.call(this, method, params);
    }
    const filter = params[0];
    const from = hexToNumber(filter.fromBlock);
    const to = hexToNumber(filter.toBlock);
    if (from === null || to === null) {
      return origSend.call(this, method, params);
    }
    headPromise ??= origSend.call(this, "eth_blockNumber", []).then(hexToNumber);
    return headPromise.then((head) => {
      const cutoff = head === null ? 0 : head - MAX_BLOCKS;
      if (to < cutoff) return [];
      if (from < cutoff) {
        if (!announced) {
          announced = true;
          console.error(
            `[bound-getlogs] limiting eth_getLogs to the last ${MAX_BLOCKS} blocks (no log index on the RPC node; $pastUpgrades will be incomplete)`,
          );
        }
        return origSend.call(this, method, [
          { ...filter, fromBlock: `0x${cutoff.toString(16)}` },
          ...params.slice(1),
        ]);
      }
      return origSend.call(this, method, params);
    });
  };
}

function hexToNumber(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  return Number.parseInt(value, 16);
}

const origLoad = Module._load;
Module._load = function (...args) {
  const exports = origLoad.apply(this, args);
  if (exports?.JsonRpcProvider?.prototype) patchSend(exports.JsonRpcProvider);
  return exports;
};

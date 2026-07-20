// Ports mev_inspect/abi.py. ABIs live at the package root `abis/` directory
// (one level above both `src/` and `dist/`), so this resolver works whether the
// code runs from source (tsx) or the compiled output. The protocol subdirectory
// is keyed by the enum *wire value* ("0x", "uniswap_v3", …), same as Python.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Protocol, protocolWireValue } from "./types.js";

const ABI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "abis");

// biome-ignore lint/suspicious/noExplicitAny: ethers accepts a raw ABI fragment array
export type RawAbi = any[];

const cache = new Map<string, RawAbi | null>();

export function getAbi(abiName: string, protocol?: Protocol | null): RawAbi | null {
  const dir = protocolWireValue(protocol);
  const key = `${dir ?? ""}/${abiName}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const path = dir ? join(ABI_DIR, dir, `${abiName}.json`) : join(ABI_DIR, `${abiName}.json`);

  let abi: RawAbi | null;
  try {
    abi = JSON.parse(readFileSync(path, "utf8")) as RawAbi;
  } catch {
    abi = null;
  }
  cache.set(key, abi);
  return abi;
}

// Address normalization happens once, at the adapter boundary (ADR-004):
// l2beat/DiscoUI uses chain-specific addresses ("eth:0x…"), raw traces and
// mev-inspect tables use plain "0x…".

const PLAIN_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const CHAIN_SPECIFIC = /^([a-z0-9]+):(0x[a-fA-F0-9]{40})$/;
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;

/** Accepts "0x…" or "<chain>:0x…" and returns the lowercased plain address, or null. */
export function normalizeAddress(input: string): string | null {
  if (PLAIN_ADDRESS.test(input)) return input.toLowerCase();
  const match = CHAIN_SPECIFIC.exec(input);
  if (match) return match[2].toLowerCase();
  return null;
}

/** Formats a plain address as a chain-specific one ("eth:0x…"). */
export function toChainSpecific(chain: string, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

export function isTxHash(input: string): boolean {
  return TX_HASH.test(input);
}

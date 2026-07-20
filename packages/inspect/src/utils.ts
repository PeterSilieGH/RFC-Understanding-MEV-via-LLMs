// Small parsing helpers. `trace_block` returns some numeric fields as hex
// strings ("0x…") and some as JSON numbers depending on the node; accept both.

export function hexToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  return 0n;
}

export function hexToNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.startsWith("0x") ? BigInt(value) : value);
  if (typeof value === "bigint") return Number(value);
  return 0;
}

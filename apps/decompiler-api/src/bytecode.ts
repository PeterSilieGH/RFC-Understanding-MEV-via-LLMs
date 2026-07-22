export interface ValidatedBytecode {
  hex: string;
  bytes: number;
}

export type BytecodeValidation =
  | { ok: true; bytecode: ValidatedBytecode }
  | {
      ok: false;
      code: "invalid_bytecode" | "bytecode_too_large";
      message: string;
      bytes: number;
    };

export function validateBytecode(value: unknown, maxBytes: number): BytecodeValidation {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    return {
      ok: false,
      code: "invalid_bytecode",
      message: "bytecode must be a 0x-prefixed hexadecimal string",
      bytes: 0,
    };
  }

  const raw = value.slice(2);
  if (raw.length === 0 || raw.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(raw)) {
    return {
      ok: false,
      code: "invalid_bytecode",
      message: "bytecode must contain a non-empty, even number of hexadecimal digits",
      bytes: Math.ceil(raw.length / 2),
    };
  }

  const bytes = raw.length / 2;
  if (bytes > maxBytes) {
    return {
      ok: false,
      code: "bytecode_too_large",
      message: `bytecode exceeds the ${maxBytes} byte limit`,
      bytes,
    };
  }

  return { ok: true, bytecode: { hex: `0x${raw.toLowerCase()}`, bytes } };
}

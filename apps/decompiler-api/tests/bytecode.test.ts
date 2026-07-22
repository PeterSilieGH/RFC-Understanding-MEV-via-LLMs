import { describe, expect, it } from "vitest";
import { validateBytecode } from "../src/bytecode.js";

describe("validateBytecode", () => {
  it("normalizes valid bytecode", () => {
    expect(validateBytecode("0x60Aa00", 3)).toEqual({
      ok: true,
      bytecode: { hex: "0x60aa00", bytes: 3 },
    });
  });

  it.each([undefined, null, "", "6000", "0x", "0x0", "0xzz"])(
    "rejects malformed input %j",
    (input) => {
      expect(validateBytecode(input, 24_576)).toMatchObject({
        ok: false,
        code: "invalid_bytecode",
      });
    },
  );

  it("rejects bytecode above the configured limit", () => {
    expect(validateBytecode("0x600000", 2)).toMatchObject({
      ok: false,
      code: "bytecode_too_large",
      bytes: 3,
    });
  });
});

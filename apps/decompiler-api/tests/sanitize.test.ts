import { describe, expect, it } from "vitest";
import { sanitizeSingleLine, sanitizeText } from "../src/sanitize.js";

describe("sanitization", () => {
  it("removes ANSI and control characters without flattening code", () => {
    expect(sanitizeText("\u001b[31mred\u001b[0m\n\tcode\u0000\u0007\u202e")).toBe("red\n\tcode");
  });

  it("turns diagnostics into a safe single line", () => {
    expect(sanitizeSingleLine("\u001b]0;title\u0007bad\nmessage\u0001")).toBe("bad message");
  });
});

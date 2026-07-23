import { describe, expect, it } from "vitest";
import {
  DISCOVERY_PROMPT_VERSION,
  MEV_DISCOVERY_PROMPT,
  VULN_DISCOVERY_PROMPT,
  discoveryBase,
} from "../src/discoveryPrompt.js";

describe("ADR-018 discovery prompt", () => {
  it("base carries BOTH the structural trace tree and the signature index", () => {
    const base = discoveryBase(
      [],
      "TREE-MARKER: root.swap()",
      "SIG-MARKER: WETH (0xabc): deposit(), withdraw()",
      "",
      "",
      [],
    );
    expect(base).toContain("Structural trace tree:");
    expect(base).toContain("TREE-MARKER: root.swap()");
    expect(base).toContain("Callable surface of the incident's contracts");
    expect(base).toContain("SIG-MARKER: WETH (0xabc): deposit(), withdraw()");
    // Order: trace tree precedes the signature index.
    expect(base.indexOf("Structural trace tree")).toBeLessThan(base.indexOf("Callable surface"));
  });

  it("omits the signature section when none is supplied", () => {
    const base = discoveryBase([], "TREE", "", "", "", []);
    expect(base).not.toContain("Callable surface");
  });

  it("both profiles are tool-forward with a decisive-verdict bar", () => {
    for (const prompt of [MEV_DISCOVERY_PROMPT, VULN_DISCOVERY_PROMPT]) {
      expect(prompt).toContain("request_contract_analysis");
      expect(prompt).toContain("cast");
      expect(prompt).toContain("get_function_code");
      expect(prompt).toContain("insufficient evidence");
    }
  });

  it("vuln uses a security-first profile that does not inherit the MEV framing", () => {
    expect(VULN_DISCOVERY_PROMPT).toContain("security researcher");
    expect(VULN_DISCOVERY_PROMPT).toContain("trust boundaries");
    // No MEV framing leaks into the vuln profile (it is an override, not a suffix).
    expect(VULN_DISCOVERY_PROMPT).not.toContain("MEV research");
    // Research ethics must be restated because it does not inherit SYSTEM.md.
    expect(VULN_DISCOVERY_PROMPT).toContain("Research ethics");
  });

  it("has a positive prompt version so a bump invalidates stale sessions", () => {
    expect(DISCOVERY_PROMPT_VERSION).toBeGreaterThan(0);
  });
});

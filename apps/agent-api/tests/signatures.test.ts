import { describe, expect, it } from "vitest";
import {
  formatSignatureList,
  lookupFunction,
  parseFunctionSignatures,
  stripComments,
} from "../src/signatures.js";

const SAMPLE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/* a flattened arbitrage bot */
contract ArbBot {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function swap(address pool, uint256 amountIn) public returns (uint256 out) {
        // string with // slash and { brace } should not confuse the parser
        require(amountIn > 0, "zero { in }");
        out = amountIn * 2;
    }

    function uniswapV3SwapCallback(int256 a0, int256 a1, bytes calldata data) external {
        owner = msg.sender;
    }

    receive() external payable {}
}
`;

describe("stripComments", () => {
  it("removes line and block comments but keeps string content", () => {
    const stripped = stripComments(SAMPLE);
    expect(stripped).not.toContain("flattened arbitrage bot");
    expect(stripped).not.toContain("SPDX");
    expect(stripped).toContain('"zero { in }"');
  });
});

describe("parseFunctionSignatures", () => {
  const entries = parseFunctionSignatures(SAMPLE);

  it("finds functions across interface and contract", () => {
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("transfer");
    expect(names).toContain("balanceOf");
    expect(names).toContain("swap");
    expect(names).toContain("constructor");
    expect(names).toContain("uniswapV3SwapCallback");
    expect(names).toContain("receive");
  });

  it("attributes functions to their container", () => {
    const swap = entries.find((e) => e.name === "swap");
    expect(swap?.contract).toBe("ArbBot");
    const transfer = entries.find((e) => e.name === "transfer");
    expect(transfer?.contract).toBe("IERC20");
  });

  it("captures bodies for concrete functions and none for interface stubs", () => {
    const swap = entries.find((e) => e.name === "swap");
    expect(swap?.body).toContain("amountIn * 2");
    const transfer = entries.find((e) => e.name === "transfer");
    expect(transfer?.body).toBeNull();
  });

  it("is not fooled by braces inside strings", () => {
    const swap = entries.find((e) => e.name === "swap");
    // the body must extend past the string's fake closing brace
    expect(swap?.body).toContain("require(amountIn > 0");
    expect(swap?.body?.endsWith("}")).toBe(true);
  });

  it("preserves return declarations in the signature", () => {
    const balanceOf = entries.find((e) => e.name === "balanceOf");
    expect(balanceOf?.signature).toContain("returns (uint256)");
  });
});

describe("lookupFunction", () => {
  const entries = parseFunctionSignatures(SAMPLE);

  it("returns a body when found", () => {
    const code = lookupFunction(entries, "swap");
    expect(code).toContain("amountIn * 2");
  });

  it("scopes by contract name", () => {
    const code = lookupFunction(entries, "transfer", "IERC20");
    expect(code).toContain("returns (bool)");
  });

  it("returns null for unknown functions", () => {
    expect(lookupFunction(entries, "nonexistent")).toBeNull();
  });
});

describe("formatSignatureList", () => {
  it("groups by container and reports emptiness", () => {
    expect(formatSignatureList([])).toBe("(no function declarations found)");
    const text = formatSignatureList(parseFunctionSignatures(SAMPLE));
    expect(text).toContain("ArbBot:");
    expect(text).toContain("IERC20:");
  });
});

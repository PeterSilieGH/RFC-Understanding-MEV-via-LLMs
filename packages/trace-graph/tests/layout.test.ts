import { describe, expect, it } from "vitest";
import type { TraceCallNode } from "../src/graph.js";
import { GAP_X, GAP_Y, NODE_HEIGHT, NODE_WIDTH, layoutTraceGraph } from "../src/layout.js";

function node(id: string, parentId: string | null, depth: number): TraceCallNode {
  return {
    id,
    parentId,
    depth,
    type: "CALL",
    from: "0xaa",
    to: "0xbb",
    selector: null,
    inputSize: 0,
    outputSize: 0,
    valueWei: null,
    gasUsed: null,
    error: null,
    revertReason: null,
    logCount: 0,
    childCount: 0,
  };
}

describe("layoutTraceGraph", () => {
  it("stacks leaves and centers parents", () => {
    // root -> a (leaf), b -> [c, d]
    const { positions, width, height } = layoutTraceGraph({
      nodes: [
        node("root", null, 0),
        node("a", "root", 1),
        node("b", "root", 1),
        node("c", "b", 2),
        node("d", "b", 2),
      ],
    });

    const slot = NODE_HEIGHT + GAP_Y;
    expect(positions.a.y).toBe(0);
    expect(positions.c.y).toBe(slot);
    expect(positions.d.y).toBe(2 * slot);
    // b centered between c and d, root centered between a and b
    expect(positions.b.y).toBe((positions.c.y + positions.d.y) / 2);
    expect(positions.root.y).toBe((positions.a.y + positions.b.y) / 2);
    // x strictly by depth
    expect(positions.root.x).toBe(0);
    expect(positions.b.x).toBe(NODE_WIDTH + GAP_X);
    expect(positions.d.x).toBe(2 * (NODE_WIDTH + GAP_X));
    expect(width).toBe(3 * (NODE_WIDTH + GAP_X) - GAP_X);
    expect(height).toBe(3 * slot - GAP_Y);
  });

  it("handles thousands of nodes without recursion issues", () => {
    // a pathological single chain 5000 deep plus 5000 leaves off the last node
    const nodes = [node("0", null, 0)];
    for (let i = 1; i < 5000; i++) {
      nodes.push(node(String(i), String(i - 1), i));
    }
    for (let i = 0; i < 5000; i++) {
      nodes.push(node(`leaf${i}`, "4999", 5000));
    }
    const { positions } = layoutTraceGraph({ nodes });
    expect(Object.keys(positions)).toHaveLength(10000);
    expect(positions.leaf4999.y).toBeGreaterThan(positions.leaf0.y);
  });

  it("treats nodes with pruned parents as roots", () => {
    const { positions } = layoutTraceGraph({
      nodes: [node("orphan.1", "orphan", 3), node("orphan.2", "orphan", 3)],
    });
    expect(positions["orphan.1"]).toBeDefined();
    expect(positions["orphan.2"]).toBeDefined();
  });
});

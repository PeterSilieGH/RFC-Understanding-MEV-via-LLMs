import type { TraceGraph } from "./graph.js";

// Layered tidy-tree layout for trace call graphs (ADR-005): x is the call
// depth, leaves take successive y slots, parents center on their children.
// O(n), deterministic, and iterative - MEV traces can nest deeply enough
// that recursion is a real stack-overflow risk.

export interface NodeRect {
  x: number;
  y: number;
}

export interface TraceLayoutResult {
  /** World-space top-left position per node id. */
  positions: Record<string, NodeRect>;
  width: number;
  height: number;
}

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 28;
export const GAP_X = 80;
export const GAP_Y = 14;

export interface LayoutOptions {
  nodeWidth?: number;
  gapX?: number;
  gapY?: number;
  /** Per-node height — DiscoUI trace nodes vary with their field count. */
  nodeHeight?: (id: string) => number;
}

interface LayoutNode {
  id: string;
  parentId: string | null;
  depth: number;
}

export function layoutTraceGraph(
  graph: { nodes: readonly LayoutNode[] },
  options: LayoutOptions = {},
): TraceLayoutResult {
  const nodeWidth = options.nodeWidth ?? NODE_WIDTH;
  const gapX = options.gapX ?? GAP_X;
  const gapY = options.gapY ?? GAP_Y;
  const heightOf = options.nodeHeight ?? (() => NODE_HEIGHT);
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const childrenOf = new Map<string, string[]>();
  const depthOf = new Map<string, number>();

  for (const node of graph.nodes) {
    depthOf.set(node.id, node.depth);
    if (node.parentId !== null && nodeIds.has(node.parentId)) {
      if (!childrenOf.has(node.parentId)) childrenOf.set(node.parentId, []);
      childrenOf.get(node.parentId)!.push(node.id);
    }
  }

  // nodes whose parent was pruned away become extra roots
  const roots = graph.nodes.filter((n) => n.parentId === null || !nodeIds.has(n.parentId));

  const positions: Record<string, NodeRect> = {};
  let yCursor = 0;
  let maxDepth = 0;

  // post-order via explicit stack: assign leaf slots on the way back up
  for (const root of roots) {
    const stack: { id: string; childIndex: number }[] = [{ id: root.id, childIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = childrenOf.get(frame.id) ?? [];
      if (frame.childIndex < children.length) {
        stack.push({ id: children[frame.childIndex], childIndex: 0 });
        frame.childIndex += 1;
        continue;
      }
      stack.pop();
      const depth = depthOf.get(frame.id) ?? 0;
      maxDepth = Math.max(maxDepth, depth);
      const x = depth * (nodeWidth + gapX);
      if (children.length === 0) {
        positions[frame.id] = { x, y: yCursor };
        yCursor += heightOf(frame.id) + gapY;
      } else {
        // center between the first child's center and the last child's center
        const first = positions[children[0]];
        const last = positions[children[children.length - 1]];
        const firstCenter = first.y + heightOf(children[0]) / 2;
        const lastCenter = last.y + heightOf(children[children.length - 1]) / 2;
        positions[frame.id] = { x, y: (firstCenter + lastCenter) / 2 - heightOf(frame.id) / 2 };
      }
    }
  }

  return {
    positions,
    width: (maxDepth + 1) * (nodeWidth + gapX) - gapX,
    height: Math.max(yCursor - gapY, heightOf(roots[0]?.id ?? "") ?? 0),
  };
}

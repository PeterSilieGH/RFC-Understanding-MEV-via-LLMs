// DIVERGENCE(mev): shared semantic-to-geometry projection for both native
// renderers. The DOM renderer consumes SVG paths; WebGL consumes the same
// cubic anchors but uploads its own line/arrow buffers.
import type { FlowEdge, FlowFact } from '@mev/trace-graph'
import type { Node } from '../store/State'

export interface FlowPoint {
  x: number
  y: number
}

export interface FlowVisualEdge {
  edge: FlowEdge
  from: FlowPoint
  controlA: FlowPoint
  controlB: FlowPoint
  to: FlowPoint
  label: FlowPoint
  accessibleLabel: string
  fromBoundary: boolean
  toBoundary: boolean
}

const PARALLEL_LANE_GAP = 14
const BOUNDARY_STUB_DISTANCE = 90

export function buildFlowGeometry(
  edges: readonly FlowEdge[],
  nodes: readonly Node[],
  hidden: readonly string[],
): FlowVisualEdge[] {
  const hiddenSet = new Set(hidden)
  const visibleNodes = nodes.filter((node) => !hiddenSet.has(node.id))
  const byId = new Map(visibleNodes.map((node) => [node.id, node]))
  const byAddress = new Map<string, Node>()
  for (const node of visibleNodes) {
    const address = normalizeAddress(node.address)
    if (!byAddress.has(address)) byAddress.set(address, node)
  }

  const preliminary = edges
    .filter(
      (edge) =>
        !(edge.from.nodeId && hiddenSet.has(edge.from.nodeId)) &&
        !(edge.to.nodeId && hiddenSet.has(edge.to.nodeId)),
    )
    .map((edge) => {
      const fromNode = resolveNode(edge.from.nodeId, edge.from.address, byId, byAddress)
      const toNode = resolveNode(edge.to.nodeId, edge.to.address, byId, byAddress)
      const anchor = findFactAnchor(edge.facts, byId)
      const fallback = fromNode ?? toNode ?? anchor
      if (!fallback) return undefined

      let fromCenter = fromNode ? center(fromNode) : undefined
      let toCenter = toNode ? center(toNode) : undefined
      if (!fromCenter && !toCenter) {
        const middle = center(fallback)
        fromCenter = { x: middle.x - BOUNDARY_STUB_DISTANCE, y: middle.y }
        toCenter = { x: middle.x + BOUNDARY_STUB_DISTANCE, y: middle.y }
      } else if (!fromCenter && toCenter) {
        fromCenter = {
          x: toCenter.x - BOUNDARY_STUB_DISTANCE,
          y: toCenter.y,
        }
      } else if (fromCenter && !toCenter) {
        toCenter = {
          x: fromCenter.x + BOUNDARY_STUB_DISTANCE,
          y: fromCenter.y,
        }
      }
      if (!fromCenter || !toCenter) return undefined

      const from = fromNode ? boxIntersection(fromNode, toCenter) : fromCenter
      const to = toNode ? boxIntersection(toNode, fromCenter) : toCenter
      const selfLoopNode = fromNode && fromNode === toNode ? fromNode : undefined
      return {
        edge,
        from: selfLoopNode
          ? {
              x: selfLoopNode.box.x + selfLoopNode.box.width * 0.7,
              y: selfLoopNode.box.y,
            }
          : from,
        to: selfLoopNode
          ? {
              x: selfLoopNode.box.x + selfLoopNode.box.width * 0.3,
              y: selfLoopNode.box.y,
            }
          : to,
        fromBoundary: !fromNode,
        toBoundary: !toNode,
        selfLoop: selfLoopNode !== undefined,
      }
    })
    .filter((edge): edge is NonNullable<typeof edge> => edge !== undefined)

  const lanes = new Map<string, typeof preliminary>()
  for (const edge of preliminary) {
    const pair = [endpointKey(edge.edge.from), endpointKey(edge.edge.to)].sort()
    const key = pair.join('|')
    const lane = lanes.get(key)
    if (lane) lane.push(edge)
    else lanes.set(key, [edge])
  }

  const output: FlowVisualEdge[] = []
  for (const lane of lanes.values()) {
    lane.sort((a, b) => a.edge.id.localeCompare(b.edge.id))
    lane.forEach((entry, index) => {
      const laneOffset = (index - (lane.length - 1) / 2) * PARALLEL_LANE_GAP
      const dx = entry.to.x - entry.from.x
      const dy = entry.to.y - entry.from.y
      const length = Math.max(1, Math.hypot(dx, dy))
      const nx = -dy / length
      const ny = dx / length
      const from = {
        x: entry.from.x + nx * laneOffset,
        y: entry.from.y + ny * laneOffset,
      }
      const to = {
        x: entry.to.x + nx * laneOffset,
        y: entry.to.y + ny * laneOffset,
      }
      const bend = Math.max(42, Math.abs(to.x - from.x) * 0.35)
      const direction = to.x >= from.x ? 1 : -1
      const controlA = entry.selfLoop
        ? { x: from.x + 55, y: from.y - 75 - Math.abs(laneOffset) }
        : { x: from.x + bend * direction, y: from.y }
      const controlB = entry.selfLoop
        ? { x: to.x - 55, y: to.y - 75 - Math.abs(laneOffset) }
        : { x: to.x - bend * direction, y: to.y }
      output.push({
        edge: entry.edge,
        from,
        controlA,
        controlB,
        to,
        label: cubicPoint(from, controlA, controlB, to, 0.5),
        accessibleLabel: `${short(entry.edge.from.address)} → ${short(entry.edge.to.address)} · ${entry.edge.label} · ${entry.edge.status}`,
        fromBoundary: entry.fromBoundary,
        toBoundary: entry.toBoundary,
      })
    })
  }
  return output.sort((a, b) => a.edge.id.localeCompare(b.edge.id))
}

export function flowPath(edge: FlowVisualEdge): string {
  return `M ${edge.from.x} ${edge.from.y} C ${edge.controlA.x} ${edge.controlA.y} ${edge.controlB.x} ${edge.controlB.y} ${edge.to.x} ${edge.to.y}`
}

function resolveNode(
  nodeId: string | undefined,
  address: string,
  byId: ReadonlyMap<string, Node>,
  byAddress: ReadonlyMap<string, Node>,
): Node | undefined {
  return (nodeId ? byId.get(nodeId) : undefined) ?? byAddress.get(normalizeAddress(address))
}

function findFactAnchor(facts: readonly FlowFact[], byId: ReadonlyMap<string, Node>) {
  for (const fact of facts) {
    const id =
      fact.type === 'call'
        ? fact.callNodeId
        : fact.type === 'native' || fact.type === 'token'
          ? fact.anchorCallNodeId
          : undefined
    if (id) {
      const node = byId.get(id)
      if (node) return node
    }
  }
  return undefined
}

function center(node: Node): FlowPoint {
  return {
    x: node.box.x + node.box.width / 2,
    y: node.box.y + node.box.height / 2,
  }
}

function boxIntersection(node: Node, toward: FlowPoint): FlowPoint {
  const c = center(node)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : node.box.width / 2 / Math.abs(dx)
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : node.box.height / 2 / Math.abs(dy)
  const t = Math.min(tx, ty)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

function cubicPoint(
  a: FlowPoint,
  b: FlowPoint,
  c: FlowPoint,
  d: FlowPoint,
  t: number,
): FlowPoint {
  const mt = 1 - t
  return {
    x: mt ** 3 * a.x + 3 * mt ** 2 * t * b.x + 3 * mt * t ** 2 * c.x + t ** 3 * d.x,
    y: mt ** 3 * a.y + 3 * mt ** 2 * t * b.y + 3 * mt * t ** 2 * c.y + t ** 3 * d.y,
  }
}

function endpointKey(endpoint: FlowEdge['from']): string {
  return endpoint.nodeId ?? normalizeAddress(endpoint.address)
}

function normalizeAddress(value: string): string {
  return value.replace(/^[a-z0-9-]+:/i, '').toLowerCase()
}

function short(address: string): string {
  const normalized = normalizeAddress(address)
  return normalized.length > 14
    ? `${normalized.slice(0, 8)}…${normalized.slice(-4)}`
    : normalized
}

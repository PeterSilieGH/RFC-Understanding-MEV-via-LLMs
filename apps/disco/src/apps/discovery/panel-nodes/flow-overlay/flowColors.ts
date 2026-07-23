// DIVERGENCE(mev): ADR-018 §1. One source of truth for edge-overlay color, read
// by both the DOM renderer (hex) and the WebGL renderer (RGBA), so the exclusive
// Default | Control | Funds modes always agree across renderers. Color is never
// the only channel — dash/marker/label carry status too (ADR-016 §5).
export type FlowColorKind = 'default' | 'control' | 'funds' | 'attempted'

export const FLOW_COLOR_HEX: Record<FlowColorKind, string> = {
  // Default — structural dependency/call graph. Brown (coffee accent).
  default: '#a8763e',
  // Control — execution ordering and status. Blue.
  control: '#38bdf8',
  // Funds — tokens involved and value transferred. Green.
  funds: '#3fb950',
  // Attempted / reverted. Red (dashed at the stroke level).
  attempted: '#fb4a35',
}

export type RGBA = [number, number, number, number]

export function flowColorRgba(kind: FlowColorKind): RGBA {
  const hex = FLOW_COLOR_HEX[kind]
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b, 1]
}

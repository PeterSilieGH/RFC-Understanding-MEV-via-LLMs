// DIVERGENCE(mev): ADR-018 §4. Single source of truth for trace-node color.
// Both the node builder (TracePanel `colorForCall`) and the corner legend
// (TraceLegend) resolve color from this one table, so a node's fill can never
// drift from the swatch the legend advertises. Every category the builder can
// emit has a legend entry and vice-versa (asserted by nodeColors.test.ts).

// Categories a trace node can fall into. `call` is the catch-all so there is no
// uncolored fallthrough.
export type TraceNodeCategory =
  | 'call'
  | 'staticcall'
  | 'delegatecall'
  | 'create'
  | 'swap'
  | 'reverted'

// Category → palette index consumed by `getColor({ color, hueShift: 0 })`.
// (0 resolves to the same default staticcall nodes already used.)
export const TRACE_NODE_COLOR: Record<TraceNodeCategory, number> = {
  reverted: 1,
  swap: 2,
  create: 5,
  call: 7,
  delegatecall: 8,
  staticcall: 0,
}

// Legend rows, in display order, with their human labels. Derived from the same
// category set so the legend and the nodes can never disagree. `as const` keeps
// the literal categories so the compile-time check below can prove completeness.
export const TRACE_LEGEND = [
  { category: 'call', label: 'call' },
  { category: 'staticcall', label: 'staticcall' },
  { category: 'delegatecall', label: 'delegatecall' },
  { category: 'create', label: 'create' },
  { category: 'swap', label: 'decoded swap' },
  { category: 'reverted', label: 'reverted' },
] as const satisfies readonly { category: TraceNodeCategory; label: string }[]

// Compile-time guarantee (checked by disco's `tsc --noEmit` test script, ADR-018
// §4): the legend lists every color category exactly once — no category the node
// builder can emit is missing a swatch, and the legend introduces none outside
// the union. `TRACE_NODE_COLOR`'s `Record<TraceNodeCategory, …>` type already
// forces the color table to cover every category. If a category is added to the
// union without a legend row (or vice-versa), `_LegendIsExhaustive` fails to
// compile.
type LegendCategory = (typeof TRACE_LEGEND)[number]['category']
type Assert<T extends true> = T
type _LegendIsExhaustive = Assert<
  [TraceNodeCategory] extends [LegendCategory]
    ? [LegendCategory] extends [TraceNodeCategory]
      ? true
      : false
    : false
>
// Reference the alias so it is not reported as unused.
export type __LegendExhaustive = _LegendIsExhaustive

// Resolve a trace call to its category. A reverted call and a decoded swap take
// precedence over the raw call type; anything else falls back to `call` so the
// result is always a known category (never undefined/uncolored).
export function categoryForCall(
  type: string,
  hasError: boolean,
  isSwap: boolean,
): TraceNodeCategory {
  if (hasError) return 'reverted'
  if (isSwap) return 'swap'
  switch (type) {
    case 'DELEGATECALL':
      return 'delegatecall'
    case 'CREATE':
    case 'CREATE2':
      return 'create'
    case 'STATICCALL':
      return 'staticcall'
    default:
      return 'call'
  }
}

// Palette index for a call, via its category. `hueShift: 0` at the call site
// keeps the node fill equal to the legend swatch.
export function colorForCall(
  call: { type: string; error?: unknown },
  isSwap: boolean,
): number {
  return TRACE_NODE_COLOR[categoryForCall(call.type, Boolean(call.error), isSwap)]
}

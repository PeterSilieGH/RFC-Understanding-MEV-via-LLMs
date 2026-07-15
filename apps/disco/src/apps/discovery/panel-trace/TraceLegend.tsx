// DIVERGENCE(mev): new file. Color legend for the trace graph - node
// headers no longer carry the raw call type (CALL/STATICCALL/...), the
// color alone encodes it, so the graph explains its palette in a corner
// overlay. Swatches come from the exact color table the nodes use.
import { getColor } from '../panel-nodes/view/colors/colors'

// keep in sync with colorForCall in TracePanel.tsx
const LEGEND: { label: string; color: number }[] = [
  { label: 'call', color: 7 },
  { label: 'staticcall', color: 0 },
  { label: 'delegatecall', color: 8 },
  { label: 'create', color: 5 },
  { label: 'decoded swap', color: 2 },
  { label: 'reverted', color: 1 },
]

export function TraceLegend() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex select-none flex-col gap-0.5 rounded border border-coffee-600 bg-coffee-800/90 p-2 text-[11px] text-coffee-200 leading-tight">
      {LEGEND.map((entry) => (
        <div key={entry.label} className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 shrink-0 rounded-sm"
            style={{
              // node ids carry no chain prefix, so color 0 resolves to the
              // same default the staticcall nodes get
              backgroundColor: getColor({ id: 'x', color: entry.color, hueShift: 0 })
                .color,
            }}
          />
          <span>{entry.label}</span>
        </div>
      ))}
    </div>
  )
}

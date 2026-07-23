// DIVERGENCE(mev): new file. Color legend for the trace graph - node
// headers no longer carry the raw call type (CALL/STATICCALL/...), the
// color alone encodes it, so the graph explains its palette in a corner
// overlay. Swatches come from the exact color table the nodes use.
// ADR-018 §4: the label + palette index come from the shared nodeColors table,
// so the legend and the node builder can never drift out of sync.
import { getColor } from '../panel-nodes/view/colors/colors'
import { TRACE_LEGEND, TRACE_NODE_COLOR } from './nodeColors'

export function TraceLegend() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex select-none flex-col gap-0.5 rounded border border-coffee-600 bg-coffee-800/90 p-2 text-[11px] text-coffee-200 leading-tight">
      {TRACE_LEGEND.map((entry) => (
        <div key={entry.category} className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 shrink-0 rounded-sm"
            style={{
              // node ids carry no chain prefix, so color 0 resolves to the
              // same default the staticcall nodes get
              backgroundColor: getColor({
                id: 'x',
                color: TRACE_NODE_COLOR[entry.category],
                hueShift: 0,
              }).color,
            }}
          />
          <span>{entry.label}</span>
        </div>
      ))}
    </div>
  )
}

// DIVERGENCE(mev): renderer-native flow views for ADR-016. DOM gets SVG;
// WebGL gets GPU paths in NodesAndConnectionsWebGL plus this HTML detail layer.
import { useId } from 'react'
import { useFlowOverlaySelection } from './FlowOverlayContext'
import {
  flowPath,
  type FlowVisualEdge,
} from './geometry'

export function useFlowGeometry() {
  return useFlowOverlaySelection()
}

export function FlowOverlayDom() {
  const { geometry } = useFlowGeometry()
  const markerPrefix = useId().replaceAll(':', '')
  const bounds = geometryBounds(geometry)
  if (!bounds) return null

  return (
    <svg
      viewBox={`${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}`}
      className="pointer-events-none absolute z-[5] overflow-visible"
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      }}
      role="img"
      aria-label="Semantic control and funds flow overlay"
    >
      <defs>
        {(['control', 'funds', 'attempted'] as const).map((kind) => (
          <marker
            key={kind}
            id={`${markerPrefix}-${kind}`}
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M 0 0 L 7 3.5 L 0 7 z" fill={flowColor(kind)} />
          </marker>
        ))}
      </defs>
      {geometry.map((visual) => {
        const kind =
          visual.edge.status === 'attempted' ? 'attempted' : visual.edge.layer
        return (
          <g key={visual.edge.id} aria-label={visual.accessibleLabel}>
            <title>{visual.accessibleLabel}</title>
            <path
              d={flowPath(visual)}
              fill="none"
              stroke={flowColor(kind)}
              strokeWidth="3"
              strokeDasharray={visual.edge.status === 'attempted' ? '7 5' : undefined}
              markerEnd={`url(#${markerPrefix}-${kind})`}
            />
            {visual.fromBoundary && (
              <circle cx={visual.from.x} cy={visual.from.y} r="4" fill={flowColor(kind)} />
            )}
            {visual.toBoundary && (
              <circle cx={visual.to.x} cy={visual.to.y} r="4" fill="none" stroke={flowColor(kind)} />
            )}
            <text
              x={visual.label.x}
              y={visual.label.y - 5}
              textAnchor="middle"
              className="fill-coffee-100 font-mono text-[10px]"
              stroke="#211a15"
              strokeWidth="4"
              paintOrder="stroke"
            >
              {visual.accessibleLabel}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** HTML labels/details owned by the WebGL renderer's coordinate surface. */
export function FlowOverlayWebGLDetails() {
  const { geometry } = useFlowGeometry()
  if (geometry.length === 0) return null
  return (
    <ol aria-label="Semantic control and funds flow details">
      {geometry.map((visual) => (
        <li
          key={visual.edge.id}
          title={visual.accessibleLabel}
          className="pointer-events-auto absolute z-20 -translate-x-1/2 rounded bg-coffee-900/90 px-1.5 py-0.5 font-mono text-[10px] text-coffee-100 shadow"
          style={{ left: visual.label.x, top: visual.label.y - 12 }}
        >
          {visual.accessibleLabel}
        </li>
      ))}
    </ol>
  )
}

export function FlowOverlayLegend() {
  const { enabled, geometry, lod, truncatedCount, originalCount } = useFlowGeometry()
  if (!enabled) return null
  return (
    <div className="pointer-events-none absolute top-2 right-2 z-20 rounded border border-coffee-600 bg-coffee-800/90 p-2 text-[11px] text-coffee-200 leading-tight">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 bg-sky-400" />
        <span>Control / configured authority</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 bg-aux-orange" />
        <span>Funds / committed</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="inline-block w-4 border-aux-red border-t border-dashed" />
        <span>Attempted / reverted</span>
      </div>
      <div className="mt-1 text-coffee-400">
        {lod} · {geometry.length}/{originalCount} edges
        {truncatedCount > 0 ? ` · ${truncatedCount} capped` : ''}
      </div>
    </div>
  )
}

function flowColor(kind: 'control' | 'funds' | 'attempted'): string {
  if (kind === 'control') return '#38bdf8'
  if (kind === 'attempted') return '#fb4a35'
  return '#fe8019'
}

function geometryBounds(geometry: readonly FlowVisualEdge[]) {
  if (geometry.length === 0) return undefined
  const points = geometry.flatMap((edge) => [
    edge.from,
    edge.controlA,
    edge.controlB,
    edge.to,
    edge.label,
  ])
  const minX = Math.min(...points.map((point) => point.x)) - 240
  const maxX = Math.max(...points.map((point) => point.x)) + 240
  const minY = Math.min(...points.map((point) => point.y)) - 80
  const maxY = Math.max(...points.map((point) => point.y)) + 80
  return {
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

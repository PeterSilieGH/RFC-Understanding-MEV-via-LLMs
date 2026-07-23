// DIVERGENCE(mev): ADR-016 flow-layer state is intentionally local UI state.
// It never enters the node store, undo history, saved layouts, or persistence.
import {
  buildConfiguredControlEdges,
  selectFlowEdges,
  type FlowEdge,
} from '@mev/trace-graph'
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { Node } from '../store/State'
import { useStore } from '../store/store'
import { buildFlowGeometry, type FlowVisualEdge } from './geometry'

export type FlowOverlayRoute = 'trace' | 'project'
// The overlay layers (edge kinds). `default` is not a layer — it means "show the
// structural graph, no semantic overlay".
export type FlowOverlayLayer = 'control' | 'funds'
// ADR-018 §1: the node pane exposes one exclusive edge mode.
export type FlowOverlayMode = 'default' | FlowOverlayLayer

interface FlowOverlaySource {
  route: FlowOverlayRoute
  edges: readonly FlowEdge[]
  loading: boolean
  error?: string
}

interface FlowOverlayState extends FlowOverlaySource {
  mode: FlowOverlayMode
  setMode: (mode: FlowOverlayMode) => void
  selection: ReturnType<typeof selectFlowEdges>
  nodes: readonly Node[]
  hidden: readonly string[]
  geometry: readonly FlowVisualEdge[]
}

const EMPTY_SOURCE: FlowOverlayState = {
  route: 'project',
  edges: [],
  loading: false,
  mode: 'default',
  setMode: () => undefined,
  selection: {
    edges: [],
    lod: 'detail',
    truncatedCount: 0,
    originalCount: 0,
  },
  nodes: [],
  hidden: [],
  geometry: [],
}

const FlowOverlayContext = createContext<FlowOverlayState>(EMPTY_SOURCE)

export function FlowOverlayProvider(props: {
  route: FlowOverlayRoute
  edges?: readonly FlowEdge[]
  loading?: boolean
  error?: string
  children: ReactNode
}) {
  // ADR-018 §1: exactly one edge mode is visible at a time. `default` shows the
  // structural graph and no semantic overlay.
  const [mode, setMode] = useState<FlowOverlayMode>('default')
  const nodes = useStore((store) => store.nodes)
  const hidden = useStore((store) => store.hidden)
  const selected = useStore((store) => store.selected)
  const projectEdges = useMemo(
    () => (props.route === 'project' ? buildProjectControlEdges(nodes) : []),
    [props.route, nodes],
  )
  const allEdges = props.route === 'project' ? projectEdges : (props.edges ?? [])
  const activeEdges = useMemo(
    () => (mode === 'default' ? [] : allEdges.filter((edge) => edge.layer === mode)),
    [allEdges, mode],
  )
  const selection = useMemo(
    () =>
      selectFlowEdges(activeEdges, {
        visibleNodeCount: Math.max(0, nodes.length - hidden.length),
        selectedNodeIds: selected,
      }),
    [activeEdges, nodes.length, hidden.length, selected],
  )
  const geometry = useMemo(
    () => buildFlowGeometry(selection.edges, nodes, hidden),
    [selection.edges, nodes, hidden],
  )
  const value = useMemo<FlowOverlayState>(
    () => ({
      route: props.route,
      edges: allEdges,
      loading: props.loading ?? false,
      error: props.error,
      mode,
      setMode,
      selection,
      nodes,
      hidden,
      geometry,
    }),
    [
      props.route,
      allEdges,
      props.loading,
      props.error,
      mode,
      selection,
      nodes,
      hidden,
      geometry,
    ],
  )
  return (
    <FlowOverlayContext.Provider value={value}>
      {props.children}
    </FlowOverlayContext.Provider>
  )
}

export function useFlowOverlayControls() {
  const state = useContext(FlowOverlayContext)
  // `default` is always selectable; a layer is disabled when it has no evidence
  // (or funds is out of scope on a project route).
  const disabledReason = (layer: FlowOverlayLayer): string | undefined => {
    if (layer === 'funds' && state.route === 'project') {
      return 'Funds requires a transaction or incident scope.'
    }
    if (state.loading) return 'Flow evidence is loading.'
    if (state.error) return `Flow evidence is unavailable: ${state.error}`
    if (!state.edges.some((edge) => edge.layer === layer)) {
      return state.route === 'project'
        ? 'No configured authority relationships are available for this project.'
        : `No ${layer} flow evidence is available for the loaded trace.`
    }
    return undefined
  }
  return {
    route: state.route,
    mode: state.mode,
    setMode: state.setMode,
    disabledReason,
  }
}

export function useFlowOverlaySelection() {
  const state = useContext(FlowOverlayContext)
  return {
    ...state.selection,
    enabled: state.mode !== 'default',
    mode: state.mode,
    hidden: state.hidden,
    nodes: state.nodes,
    geometry: state.geometry,
  }
}

/**
 * Project nodes contain configured dependencies. Authority-like fields are
 * reversed into controller -> controlled direction; arbitrary address fields
 * are not misrepresented as fund flow or permission.
 */
export function buildProjectControlEdges(nodes: readonly Node[]): FlowEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const permissions = []
  for (const controlled of nodes) {
    for (const field of controlled.fields) {
      const controller = byId.get(field.target)
      if (!controller || !isAuthorityField(field.name, controller)) continue
      permissions.push({
        controller: { address: controller.address, nodeId: controller.id },
        target: { address: controlled.address, nodeId: controlled.id },
        permission: field.name,
        direct: true,
      })
    }
  }
  return buildConfiguredControlEdges(permissions)
}

function isAuthorityField(name: string, target: Node): boolean {
  return (
    target.addressType === 'EOAPermissioned' ||
    /admin|authority|controller|govern|guardian|operator|owner|permission|proposer|role|upgrade/i.test(
      name,
    )
  )
}

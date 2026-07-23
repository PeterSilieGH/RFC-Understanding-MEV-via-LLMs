// DIVERGENCE(mev): new panel. Renders MEV execution traces from trace-api
// with the exact machinery of the nodes panel - same store shape (own
// instance via NodesStoreProvider), same Viewport/Controls, so selection,
// dragging, hiding, coloring, undo/redo, and stored layouts all just work.
// M4: nodes are overlaid with the explorer's MEV facts (decoded swaps turn
// orange). Post-M4.5 polish (wp-trace-polish): the manual tx form only
// renders on /ui/trace (deep links determine the tx; the List switches
// legs), call types are expressed by color alone (legend overlay), and
// per-call details live in the docked `trace` panel instead of a floating
// sidebar - the graph publishes its active tx in the workspace store.
import {
  buildTraceFlowEdges,
  isTxHash,
  layoutTraceGraph,
  type TraceCallNode,
  type TraceGraph,
} from '@mev/trace-graph'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getTxMev,
  type TraceWorkspace,
  type TxMev,
  type TxSwap,
  traceGraphQueryOptions,
  traceWorkspaceQueryOptions,
} from '../../../api/traces'
import { LoadingState } from '../../../components/LoadingState'
import { Controls } from '../panel-nodes/controls/Controls'
import { FlowOverlayProvider } from '../panel-nodes/flow-overlay/FlowOverlayContext'
import type { Field, Node } from '../panel-nodes/store/State'
import { NodesStoreProvider, traceNodesStore } from '../panel-nodes/store/store'
import { NODE_WIDTH } from '../panel-nodes/store/utils/constants'
import { Viewport } from '../panel-nodes/view/Viewport'
import { usePanelStore } from '../store/panel-store'
import { colorForCall } from './nodeColors'
import { TraceLegend } from './TraceLegend'
import { useTraceWorkspaceStore } from './workspace-store'

const TREE_GAP_X = 120
const TREE_GAP_Y = 24

export function TracePanel(props: { initialTxHash?: string }) {
  const [input, setInput] = useState(props.initialTxHash ?? '')
  const [inputError, setInputError] = useState<string>()
  const [txHash, setTxHash] = useState<string>(() =>
    props.initialTxHash && isTxHash(props.initialTxHash.toLowerCase())
      ? props.initialTxHash.toLowerCase()
      : '',
  )

  const response = useQuery(traceGraphQueryOptions(txHash || undefined))

  const mevResponse = useQuery({
    queryKey: ['mev-tx', txHash],
    queryFn: () => getTxMev(txHash),
    enabled: txHash !== '',
    // an uninspected block can get inspected later - allow refetching
    staleTime: 30_000,
    retry: 1,
  })

  // Workspace enrichment (ADR-008): discovered contract names + decoded
  // selectors of the incident's synthetic project. Only fetched when the
  // panel sits on a deep-linked route - the query is what triggers the
  // bounded discovery run, so manual traces must not fire it.
  const { txHash: routeTxHash } = useParams()
  const workspace = useQuery(traceWorkspaceQueryOptions(routeTxHash))
  const flowEdges = useMemo(
    () => traceFlowEdges(response.data, workspace.data),
    [response.data, workspace.data],
  )

  const swapsByNodeId = swapsForTx(mevResponse.data, txHash)
  useLoadTraceNodes(response.data, swapsByNodeId, workspace.data)
  useFocusRequests(txHash, response.data, setInput, setTxHash)
  useSyncGraphSelectionToPanelStore(workspace.data)
  usePublishActiveTxHash(txHash)

  function openTx(value: string) {
    const hash = value.trim().toLowerCase()
    if (!isTxHash(hash)) {
      setInputError('Not a transaction hash (0x…, 32 bytes)')
      return
    }
    setInputError(undefined)
    setInput(hash)
    setTxHash(hash)
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    openTx(input)
  }

  return (
    <NodesStoreProvider value={traceNodesStore}>
      <FlowOverlayProvider
        route="trace"
        edges={flowEdges}
        loading={response.isLoading && txHash !== ''}
        error={response.isError ? (response.error as Error).message : undefined}
      >
        <div className="flex h-full w-full flex-col">
          {/* deep links determine the tx; the form is only the manual entry point */}
          {!routeTxHash && (
            <form
              onSubmit={onSubmit}
              className="flex items-center gap-2 border-coffee-600 border-b p-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Transaction hash (0x…)"
                spellCheck={false}
                className="h-7 min-w-0 flex-1 rounded bg-coffee-800 px-2 font-mono text-coffee-100 text-xs outline-none placeholder:text-coffee-400"
              />
              <button
                type="submit"
                className="h-7 rounded bg-coffee-600 px-3 font-bold text-coffee-100 text-xs uppercase hover:bg-coffee-500"
              >
                Trace
              </button>
            </form>
          )}
          {inputError && <p className="p-2 text-aux-red text-xs">{inputError}</p>}
          {response.isError && (
            <p className="p-2 text-aux-red text-xs">
              {(response.error as Error).message}
            </p>
          )}
          <div className="relative min-h-0 w-full flex-1">
            {response.isLoading && txHash !== '' ? (
              <LoadingState />
            ) : (
              <>
                <Viewport />
                <Controls />
                <TraceLegend />
              </>
            )}
          </div>
        </div>
      </FlowOverlayProvider>
    </NodesStoreProvider>
  )
}

function traceFlowEdges(
  graph: TraceGraph | undefined,
  workspace: TraceWorkspace | undefined,
) {
  if (!graph) return []
  const edges =
    graph.flowEdges ??
    buildTraceFlowEdges({
      transactionHash: graph.transactionHash,
      chain: graph.chain,
      nodes: graph.nodes,
      edges: graph.edges,
      tokenTransfers: graph.tokenTransfers,
    })
  return edges.map((edge) => {
    if (edge.layer !== 'control') return edge
    const call = edge.facts.find((fact) => fact.type === 'call')
    if (!call || call.type !== 'call') return edge
    const selector = call.selector
      ? (workspace?.selectors?.[call.selector] ?? call.selector)
      : '(fallback)'
    const gas = call.gasUsed ? ` · ${call.gasUsed} gas` : ''
    const failed = call.failed ? ' · failed' : ''
    return {
      ...edge,
      label: `${call.callType} ${selector} ×${edge.count}${gas}${failed}`,
    }
  })
}

/**
 * The docked trace details panel lives outside this component tree; it
 * learns which leg's graph is on screen through the workspace store.
 */
function usePublishActiveTxHash(txHash: string) {
  const setActiveTxHash = useTraceWorkspaceStore((state) => state.setActiveTxHash)
  useEffect(() => {
    setActiveTxHash(txHash === '' ? undefined : txHash)
    return () => setActiveTxHash(undefined)
  }, [txHash, setActiveTxHash])
}

/** Decoded swaps of the traced tx, keyed by trace-graph node id. */
export function swapsForTx(mev: TxMev | undefined, txHash: string): Map<string, TxSwap> {
  const byNodeId = new Map<string, TxSwap>()
  if (!mev?.transaction || mev.transaction.hash !== txHash) {
    return byNodeId
  }
  for (const swap of mev.transaction.swaps) {
    // mev-inspect trace_address [] is the top frame; [0,1] -> node "0.1"
    const nodeId = swap.traceAddress.length === 0 ? 'root' : swap.traceAddress.join('.')
    byNodeId.set(nodeId, swap)
  }
  return byNodeId
}

function useLoadTraceNodes(
  data: TraceGraph | undefined,
  swapsByNodeId: Map<string, TxSwap>,
  workspace: TraceWorkspace | undefined,
) {
  // reloading on enrichment arrival re-runs the deterministic layout, so the
  // graph looks identical - swap nodes just gain their color and label,
  // and workspace arrival swaps addresses for discovered names (T5)
  const swapsKey = [...swapsByNodeId.keys()].join(',')
  const namesKey = workspace?.status === 'ready' ? workspace.project : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: swapsKey/namesKey stand in for the maps
  useEffect(() => {
    const store = traceNodesStore.getState()
    store.clear()
    if (!data) {
      return
    }
    store.loadNodes(
      `trace:${data.transactionHash}`,
      toTraceNodes(data, swapsByNodeId, workspace),
    )

    // loadNodes computed each node's height from its field count - now place
    // the call tree deterministically (depth on x, siblings stacked on y)
    const loaded = traceNodesStore.getState()
    const heightById = new Map(loaded.nodes.map((n) => [n.id, n.box.height]))
    const { positions } = layoutTraceGraph(
      { nodes: data.nodes },
      {
        nodeWidth: NODE_WIDTH,
        gapX: TREE_GAP_X,
        gapY: TREE_GAP_Y,
        nodeHeight: (id) => heightById.get(id) ?? 40,
      },
    )
    loaded.layout(positions)
  }, [data, swapsKey, namesKey])
}

/**
 * The List panel (ADR-008) asks the graph to show a call node of a specific
 * leg: switch the traced transaction when needed, then select + center the
 * node once its graph is loaded (useLoadTraceNodes runs first, hook order).
 */
function useFocusRequests(
  txHash: string,
  data: TraceGraph | undefined,
  setInput: (value: string) => void,
  setTxHash: (value: string) => void,
) {
  const focusRequest = useTraceWorkspaceStore((state) => state.focusRequest)
  useEffect(() => {
    if (!focusRequest) return
    if (focusRequest.txHash !== txHash) {
      setInput(focusRequest.txHash)
      setTxHash(focusRequest.txHash)
      return
    }
    if (data?.transactionHash === focusRequest.txHash) {
      traceNodesStore.getState().selectAndFocus(focusRequest.nodeId)
    }
  }, [focusRequest, txHash, data, setInput, setTxHash])
}

/**
 * Selecting call nodes in the graph resolves them to contract addresses in the
 * shared panel-store, so values/code/preview follow (ADR-008). Two calls into
 * the same contract select the same address - that is the intended semantic;
 * the per-call view lives in the trace sidebar.
 *
 * DIVERGENCE(mev): the Analyze panel (ADR-009) operates on the multi-select
 * `highlighted` set. Shift-clicking / rubber-banding several call nodes in the
 * trace graph must surface ALL their contracts, not only the first - so we map
 * every selected node to its (deduped) contract address and publish the whole
 * list. `selected` (single, drives values/code) stays the first of them.
 */
function useSyncGraphSelectionToPanelStore(workspace: TraceWorkspace | undefined) {
  const graphSelected = traceNodesStore((state) => state.selected)
  const select = usePanelStore((state) => state.select)
  const highlight = usePanelStore((state) => state.highlight)
  useEffect(() => {
    if (!workspace?.contracts) return
    const nodes = traceNodesStore.getState().nodes
    const addresses: string[] = []
    for (const id of graphSelected) {
      const node = nodes.find((n) => n.id === id)
      const contract = node && workspace.contracts[node.address.toLowerCase()]
      if (contract && !addresses.includes(contract.address)) {
        addresses.push(contract.address)
      }
    }
    if (addresses.length === 0) return
    highlight(addresses)
    select(addresses[0])
  }, [graphSelected, workspace, select, highlight])
}

function shortAddress(address: string | null): string {
  if (!address) return '(create)'
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function toTraceNodes(
  graph: TraceGraph,
  swapsByNodeId: Map<string, TxSwap>,
  workspace?: TraceWorkspace,
): Node[] {
  // T5 (ADR-008): discovered names for node titles, decoded selectors for
  // field labels; graceful fallback to addresses/raw 4-bytes until the
  // synthetic project is ready. Call types are not spelled out - the node
  // color carries them (TraceLegend).
  const displayAddress = (address: string | null): string => {
    const name = address ? workspace?.contracts?.[address.toLowerCase()]?.name : undefined
    return name || shortAddress(address)
  }
  const fieldLabel = (child: TraceCallNode): string => {
    if (child.selector) {
      return workspace?.selectors?.[child.selector] ?? child.selector
    }
    // no calldata: a plain value transfer or a contract creation
    return child.type.startsWith('CREATE') ? 'create' : '()'
  }
  const childrenOf = new Map<string, TraceCallNode[]>()
  for (const node of graph.nodes) {
    if (node.parentId === null) continue
    let children = childrenOf.get(node.parentId)
    if (!children) {
      children = []
      childrenOf.set(node.parentId, children)
    }
    children.push(node)
  }

  const transferCount = new Map<string, number>()
  for (const transfer of graph.tokenTransfers) {
    transferCount.set(transfer.nodeId, (transferCount.get(transfer.nodeId) ?? 0) + 1)
  }

  return graph.nodes.map((call) => {
    const children = childrenOf.get(call.id) ?? []
    const fields: Field[] = children.map((child) => ({
      name: `${fieldLabel(child)}${child.error ? ' ✗' : ''}`,
      target: child.id,
      box: { x: 0, y: 0, width: 0, height: 0 },
      connection: {
        from: { direction: 'left', x: 0, y: 0 },
        to: { direction: 'left', x: 0, y: 0 },
      },
    }))

    const swap = swapsByNodeId.get(call.id)
    const transfers = transferCount.get(call.id) ?? 0
    const suffixes = [
      call.error ? '✗' : undefined,
      swap ? `⇅ ${swap.protocol ?? 'swap'}` : undefined,
      transfers > 0 ? `${transfers}⇄` : undefined,
    ].filter((x) => x !== undefined)

    // a decoded swap titles the node with its pool, not the call target
    // (usually the same contract, but the swap decoding is authoritative)
    const titleAddress = swap ? swap.contractAddress : call.to

    return {
      id: call.id,
      address: call.to ?? call.from,
      isInitial: call.parentId === null,
      isReachable: true,
      hasTemplate: false,
      addressType: call.error ? 'Unverified' : 'Contract',
      name: `${displayAddress(titleAddress)}${suffixes.length > 0 ? ` ${suffixes.join(' ')}` : ''}`,
      fields,
      hiddenFields: [],
      box: { x: 0, y: 0, width: NODE_WIDTH, height: 0 },
      color: colorForCall(call, swap !== undefined),
      hueShift: 0,
      data: call,
    }
  })
}

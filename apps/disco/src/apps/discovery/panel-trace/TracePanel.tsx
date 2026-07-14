// DIVERGENCE(mev): new panel. Renders MEV execution traces from trace-api
// with the exact machinery of the nodes panel - same store shape (own
// instance via NodesStoreProvider), same Viewport/Controls, so selection,
// dragging, hiding, coloring, undo/redo, and stored layouts all just work.
// M4: nodes are overlaid with the explorer's MEV facts (decoded swaps turn
// orange), a strip above the graph shows the transaction's MEV role with
// jumps to related legs, and a details sidebar links contract sources.
import {
  isTxHash,
  layoutTraceGraph,
  type TraceCallNode,
  type TraceGraph,
} from '@mev/trace-graph'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getTraceGraph, getTxMev, type TxMev, type TxSwap } from '../../../api/traces'
import { LoadingState } from '../../../components/LoadingState'
import { Controls } from '../panel-nodes/controls/Controls'
import type { Field, Node } from '../panel-nodes/store/State'
import { NodesStoreProvider, traceNodesStore } from '../panel-nodes/store/store'
import { NODE_WIDTH } from '../panel-nodes/store/utils/constants'
import { Viewport } from '../panel-nodes/view/Viewport'
import { TraceMevStrip } from './TraceMevStrip'
import { TraceNodeDetails } from './TraceNodeDetails'

const TREE_GAP_X = 120
const TREE_GAP_Y = 24

// 1-based indexes into SELECTABLE_COLORS (view/colors/colors.ts)
const COLOR_RED = 1
const COLOR_ORANGE = 2
const COLOR_GREEN = 5
const COLOR_BLUE = 7
const COLOR_PURPLE = 8

export function TracePanel(props: { initialTxHash?: string }) {
  const [input, setInput] = useState(props.initialTxHash ?? '')
  const [inputError, setInputError] = useState<string>()
  const [txHash, setTxHash] = useState<string>(() =>
    props.initialTxHash && isTxHash(props.initialTxHash.toLowerCase())
      ? props.initialTxHash.toLowerCase()
      : '',
  )

  const response = useQuery({
    queryKey: ['traces', txHash],
    queryFn: () => getTraceGraph(txHash),
    enabled: txHash !== '',
    staleTime: Number.POSITIVE_INFINITY,
  })

  const mevResponse = useQuery({
    queryKey: ['mev-tx', txHash],
    queryFn: () => getTxMev(txHash),
    enabled: txHash !== '',
    // an uninspected block can get inspected later - allow refetching
    staleTime: 30_000,
    retry: 1,
  })

  const swapsByNodeId = swapsForTx(mevResponse.data, txHash)
  useLoadTraceNodes(response.data, swapsByNodeId)

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
      <div className="flex h-full w-full flex-col">
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
        {inputError && <p className="p-2 text-aux-red text-xs">{inputError}</p>}
        {response.isError && (
          <p className="p-2 text-aux-red text-xs">
            {(response.error as Error).message}
          </p>
        )}
        {txHash !== '' && (
          <TraceMevStrip
            mev={mevResponse.data}
            isLoading={mevResponse.isLoading}
            onOpenTx={openTx}
          />
        )}
        <div className="relative min-h-0 w-full flex-1">
          {response.isLoading && txHash !== '' ? (
            <LoadingState />
          ) : (
            <>
              <Viewport />
              <Controls />
              <TraceNodeDetails swapsByNodeId={swapsByNodeId} />
            </>
          )}
        </div>
      </div>
    </NodesStoreProvider>
  )
}

/** Decoded swaps of the traced tx, keyed by trace-graph node id. */
function swapsForTx(mev: TxMev | undefined, txHash: string): Map<string, TxSwap> {
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
) {
  // reloading on enrichment arrival re-runs the deterministic layout, so the
  // graph looks identical - swap nodes just gain their color and label
  const swapsKey = [...swapsByNodeId.keys()].join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: swapsKey stands in for the map
  useEffect(() => {
    const store = traceNodesStore.getState()
    store.clear()
    if (!data) {
      return
    }
    store.loadNodes(`trace:${data.transactionHash}`, toTraceNodes(data, swapsByNodeId))

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
  }, [data, swapsKey])
}

function colorForCall(call: TraceCallNode, isSwap: boolean): number {
  if (call.error) return COLOR_RED
  if (isSwap) return COLOR_ORANGE
  switch (call.type) {
    case 'DELEGATECALL':
      return COLOR_PURPLE
    case 'CREATE':
    case 'CREATE2':
      return COLOR_GREEN
    case 'STATICCALL':
      return 0
    default:
      return COLOR_BLUE
  }
}

function shortAddress(address: string | null): string {
  if (!address) return '(create)'
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function toTraceNodes(graph: TraceGraph, swapsByNodeId: Map<string, TxSwap>): Node[] {
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
      name: `${child.type.toLowerCase()}${child.selector ? ` ${child.selector}` : ''}${child.error ? ' ✗' : ''}`,
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

    return {
      id: call.id,
      address: call.to ?? call.from,
      isInitial: call.parentId === null,
      isReachable: true,
      hasTemplate: false,
      addressType: call.error ? 'Unverified' : 'Contract',
      name: `${call.type} ${shortAddress(call.to)}${suffixes.length > 0 ? ` ${suffixes.join(' ')}` : ''}`,
      fields,
      hiddenFields: [],
      box: { x: 0, y: 0, width: NODE_WIDTH, height: 0 },
      color: colorForCall(call, swap !== undefined),
      hueShift: 0,
      data: call,
    }
  })
}

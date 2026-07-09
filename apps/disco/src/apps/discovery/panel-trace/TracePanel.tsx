// DIVERGENCE(mev): new panel. Renders MEV execution traces from trace-api
// with the exact machinery of the nodes panel - same store shape (own
// instance via NodesStoreProvider), same Viewport/Controls, so selection,
// dragging, hiding, coloring, undo/redo, and stored layouts all just work.
import {
  isTxHash,
  layoutTraceGraph,
  type TraceCallNode,
  type TraceGraph,
} from '@mev/trace-graph'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getTraceGraph } from '../../../api/traces'
import { LoadingState } from '../../../components/LoadingState'
import { Controls } from '../panel-nodes/controls/Controls'
import type { Field, Node } from '../panel-nodes/store/State'
import { NodesStoreProvider, traceNodesStore } from '../panel-nodes/store/store'
import { NODE_WIDTH } from '../panel-nodes/store/utils/constants'
import { Viewport } from '../panel-nodes/view/Viewport'

const TREE_GAP_X = 120
const TREE_GAP_Y = 24

// 1-based indexes into SELECTABLE_COLORS (view/colors/colors.ts)
const COLOR_RED = 1
const COLOR_GREEN = 5
const COLOR_BLUE = 7
const COLOR_PURPLE = 8

export function TracePanel() {
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string>()
  const [txHash, setTxHash] = useState<string>()

  const response = useQuery({
    queryKey: ['traces', txHash],
    queryFn: () => getTraceGraph(txHash ?? ''),
    enabled: txHash !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })

  useLoadTraceNodes(response.data)

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const value = input.trim().toLowerCase()
    if (!isTxHash(value)) {
      setInputError('Not a transaction hash (0x…, 32 bytes)')
      return
    }
    setInputError(undefined)
    setTxHash(value)
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
        <div className="relative min-h-0 w-full flex-1">
          {response.isLoading && txHash !== undefined ? (
            <LoadingState />
          ) : (
            <>
              <Viewport />
              <Controls />
            </>
          )}
        </div>
      </div>
    </NodesStoreProvider>
  )
}

function useLoadTraceNodes(data: TraceGraph | undefined) {
  useEffect(() => {
    const store = traceNodesStore.getState()
    store.clear()
    if (!data) {
      return
    }
    store.loadNodes(`trace:${data.transactionHash}`, toTraceNodes(data))

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
  }, [data])
}

function colorForCall(call: TraceCallNode): number {
  if (call.error) return COLOR_RED
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

function toTraceNodes(graph: TraceGraph): Node[] {
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

    const transfers = transferCount.get(call.id) ?? 0
    const suffixes = [
      call.error ? '✗' : undefined,
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
      color: colorForCall(call),
      hueShift: 0,
      data: call,
    }
  })
}

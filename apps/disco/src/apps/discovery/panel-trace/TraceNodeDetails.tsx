// DIVERGENCE(mev): new file. Details sidebar for the selected trace node
// (M4): call facts, the decoded swap at this call (if any), and one-click
// verified contract sources via trace-api (Etherscan-backed).
import type { TraceCallNode } from '@mev/trace-graph'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { getTraceContractCode, type TxSwap } from '../../../api/traces'
import { useStore, useStoreApi } from '../panel-nodes/store/store'
import { fmtAmount } from './TraceMevStrip'

export function TraceNodeDetails(props: { swapsByNodeId: Map<string, TxSwap> }) {
  const selected = useStore((state) => state.selected)
  const nodes = useStore((state) => state.nodes)
  const storeApi = useStoreApi()

  const node = selected.length === 1 ? nodes.find((n) => n.id === selected[0]) : undefined
  const call = node?.data as TraceCallNode | undefined
  const address = call?.to ?? call?.from
  const swap = node ? props.swapsByNodeId.get(node.id) : undefined

  const [showSources, setShowSources] = useState(false)
  const [sourceName, setSourceName] = useState<string>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset viewer when the selection moves
  useEffect(() => {
    setShowSources(false)
    setSourceName(undefined)
  }, [node?.id])

  const codeResponse = useQuery({
    queryKey: ['trace-contract-code', address],
    queryFn: () => getTraceContractCode(address ?? ''),
    enabled: showSources && address !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })

  if (!node || !call) {
    return null
  }

  const sources = codeResponse.data?.sources ?? []
  const activeSource =
    sources.find((s) => s.name === sourceName) ?? sources[0]

  return (
    <div className="absolute top-0 right-0 z-10 flex h-full w-[26rem] max-w-[60%] flex-col gap-2 overflow-y-auto border-coffee-600 border-l bg-coffee-800/95 p-3 text-coffee-200 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-bold text-coffee-100 uppercase">
          {call.type}
          {codeResponse.data ? ` · ${codeResponse.data.entryName}` : ''}
        </span>
        <button
          type="button"
          title="Close"
          onClick={() => storeApi.setState({ selected: [] })}
          className="px-1 text-coffee-400 hover:text-coffee-100"
        >
          ✕
        </button>
      </div>

      <Row label="from">
        <Address address={call.from} />
      </Row>
      <Row label="to">
        <Address address={call.to} />
      </Row>
      {call.selector && <Row label="selector">{call.selector}</Row>}
      {call.valueWei && call.valueWei !== '0' && (
        <Row label="value">{(Number(call.valueWei) / 1e18).toFixed(6)} ETH</Row>
      )}
      {call.gasUsed && <Row label="gas used">{Number(call.gasUsed)}</Row>}
      {call.logCount > 0 && <Row label="logs">{call.logCount}</Row>}
      {call.error && (
        <Row label="error">
          <span className="text-aux-red">
            {call.error}
            {call.revertReason ? ` - ${call.revertReason}` : ''}
          </span>
        </Row>
      )}

      {swap && (
        <div className="rounded bg-coffee-700 p-2">
          <p className="mb-1 font-bold text-coffee-100 uppercase">
            Decoded swap {swap.protocol ? `(${swap.protocol})` : ''}
          </p>
          <Row label="pool">
            <Address address={swap.contractAddress} />
          </Row>
          {swap.tokenIn && <Row label="in">{fmtAmount(swap.tokenIn)}</Row>}
          {swap.tokenOut && <Row label="out">{fmtAmount(swap.tokenOut)}</Row>}
          {swap.error && (
            <Row label="error">
              <span className="text-aux-red">{swap.error}</span>
            </Row>
          )}
        </div>
      )}

      {address && !showSources && (
        <button
          type="button"
          onClick={() => setShowSources(true)}
          className="h-7 rounded bg-coffee-600 px-3 font-bold text-coffee-100 uppercase hover:bg-coffee-500"
        >
          View contract source
        </button>
      )}

      {showSources && codeResponse.isPending && (
        <p className="text-coffee-400">Fetching verified sources…</p>
      )}
      {showSources && codeResponse.isError && (
        <p className="text-aux-red">{(codeResponse.error as Error).message}</p>
      )}
      {showSources && sources.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          {sources.length > 1 && (
            <select
              value={activeSource?.name}
              onChange={(e) => setSourceName(e.target.value)}
              className="h-7 rounded bg-coffee-700 px-2 text-coffee-100 outline-none"
            >
              {sources.map((source) => (
                <option key={source.name} value={source.name}>
                  {source.name}
                </option>
              ))}
            </select>
          )}
          <pre className="min-h-0 flex-1 select-text overflow-auto rounded border border-coffee-600 bg-coffee-900 p-2 font-mono text-[11px] leading-snug">
            {activeSource?.code}
          </pre>
        </div>
      )}
    </div>
  )
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-coffee-400">{props.label}</span>
      <span className="min-w-0 break-all font-mono">{props.children}</span>
    </div>
  )
}

function Address(props: { address: string | null }) {
  if (!props.address) return <span>(create)</span>
  return (
    <a
      href={`https://etherscan.io/address/${props.address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:text-coffee-100"
    >
      {props.address}
    </a>
  )
}

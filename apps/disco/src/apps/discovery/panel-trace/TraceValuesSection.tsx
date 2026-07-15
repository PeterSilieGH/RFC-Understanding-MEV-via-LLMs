// DIVERGENCE(mev): new file. "Trace" folder inside the Values panel
// (wp-trace-polish, revised): per-call details of the trace-graph selection
// - call facts and the decoded swap - rendered as a section alongside
// Fields/ABI instead of a separate docked pane. Sources live in the code
// panel. Renders nothing outside the trace workspace or without a
// selected call node.
import type { TraceCallNode } from '@mev/trace-graph'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  getTxMev,
  type TraceWorkspace,
  traceWorkspaceQueryOptions,
} from '../../../api/traces'
import { Folder } from '../panel-values/Folder'
import { traceNodesStore } from '../panel-nodes/store/store'
import { fmtAmount } from './mev-format'
import { swapsForTx } from './TracePanel'
import { useTraceWorkspaceStore } from './workspace-store'

export function TraceValuesSection() {
  const { txHash } = useParams()
  if (!txHash) {
    return null
  }
  return <TraceCallSection routeTxHash={txHash} />
}

function TraceCallSection(props: { routeTxHash: string }) {
  const activeTxHash = useTraceWorkspaceStore((state) => state.activeTxHash)
  const selected = traceNodesStore((state) => state.selected)
  const nodes = traceNodesStore((state) => state.nodes)
  const workspace = useQuery(traceWorkspaceQueryOptions(props.routeTxHash))

  const mevResponse = useQuery({
    queryKey: ['mev-tx', activeTxHash],
    queryFn: () => getTxMev(activeTxHash ?? ''),
    enabled: !!activeTxHash,
    staleTime: 30_000,
    retry: 1,
  })

  const node = selected.length === 1 ? nodes.find((n) => n.id === selected[0]) : undefined
  const call = node?.data as TraceCallNode | undefined
  if (!node || !call) {
    return null
  }

  const swaps = activeTxHash
    ? swapsForTx(mevResponse.data, activeTxHash)
    : undefined
  const swap = swaps?.get(node.id)

  return (
    <Folder title="Trace">
      <div className="flex flex-col gap-1 bg-coffee-900 px-4 py-2 text-xs">
        <Row label="from">
          <Address address={call.from} name={contractName(call.from, workspace.data)} />
        </Row>
        <Row label="to">
          <Address address={call.to} name={contractName(call.to, workspace.data)} />
        </Row>
        {call.selector && (
          <Row label="function">
            {workspace.data?.selectors?.[call.selector] ?? call.selector}
          </Row>
        )}
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
          <div className="mt-1 rounded bg-coffee-700 p-2">
            <p className="mb-1 font-bold text-coffee-100 uppercase">
              Decoded swap {swap.protocol ? `(${swap.protocol})` : ''}
            </p>
            <Row label="pool">
              <Address
                address={swap.contractAddress}
                name={contractName(swap.contractAddress, workspace.data)}
              />
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
      </div>
    </Folder>
  )
}

function contractName(
  address: string | null | undefined,
  workspace: TraceWorkspace | undefined,
): string | undefined {
  if (!address) return undefined
  return workspace?.contracts?.[address.toLowerCase()]?.name ?? undefined
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-coffee-400">{props.label}</span>
      <span className="min-w-0 break-all font-mono">{props.children}</span>
    </div>
  )
}

function Address(props: { address: string | null; name?: string }) {
  if (!props.address) return <span>(create)</span>
  return (
    <a
      href={`https://etherscan.io/address/${props.address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:text-coffee-100"
      title={props.address}
    >
      {props.name ?? props.address}
    </a>
  )
}

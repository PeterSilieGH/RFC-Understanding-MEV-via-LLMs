// DIVERGENCE(mev): new file. Incident-shaped List panel for the trace
// workspace (ADR-008): the Initial folder holds the root call of every leg
// of the MEV incident (front-run, victims, back-run, …), then one folder per
// leg with that leg's remaining call nodes in trace order. Entries show the
// discovered contract name and the decoded selector; selecting one drives
// the shared panel-store selection (values/code/preview) and asks the graph
// to focus the call node. Outside the trace workspace the stock ListPanel
// renders instead.
import { useQueries, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getTraceGraph,
  type TraceWorkspace,
  type TraceWorkspaceLeg,
  traceWorkspaceQueryOptions,
} from '../../../api/traces'
import { ErrorState } from '../../../components/ErrorState'
import { LoadingState } from '../../../components/LoadingState'
import { IconChevronDown } from '../../../icons/IconChevronDown'
import { IconChevronRight } from '../../../icons/IconChevronRight'
import { IconFolder } from '../../../icons/IconFolder'
import { IconFolderOpened } from '../../../icons/IconFolderOpened'
import { ListPanel } from '../panel-list/ListPanel'
import { usePanelStore } from '../store/panel-store'
import { useTraceWorkspaceStore } from './workspace-store'

export function ListTracePanel() {
  const { txHash } = useParams()
  if (txHash) {
    return <TraceListPanel txHash={txHash} />
  }
  return <ListPanel />
}

const ROLE_ORDER = ['frontrun', 'victim', 'backrun', 'winner', 'loser', 'counterpart', 'root']
const ROLE_LABEL: Record<string, string> = {
  frontrun: 'Front-run',
  backrun: 'Back-run',
  victim: 'Victim',
  winner: 'Winner',
  loser: 'Loser',
  counterpart: 'Counterpart',
  root: 'Trace',
}

function TraceListPanel(props: { txHash: string }) {
  const workspace = useQuery(traceWorkspaceQueryOptions(props.txHash))

  const legs = sortLegs(workspace.data?.legs ?? [])
  const traces = useQueries({
    queries: legs.map((leg) => ({
      queryKey: ['traces', leg.txHash],
      queryFn: () => getTraceGraph(leg.txHash),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })

  if (workspace.isPending) {
    return <LoadingState />
  }
  if (workspace.isError) {
    return <ErrorState />
  }

  const labels = legLabels(legs)
  return (
    <div className="h-full w-full overflow-x-hidden">
      <ol>
        <li>
          <Folder title="Initial">
            {legs.map((leg, i) => {
              const root = traces[i]?.data?.nodes.find((n) => n.parentId === null)
              if (!root) return null
              return (
                <CallEntry
                  key={leg.txHash}
                  txHash={leg.txHash}
                  nodeId={root.id}
                  label={`${labels[i]} · ${entryName(root.to, root.selector, workspace.data)}`}
                  workspace={workspace.data}
                  address={root.to}
                />
              )
            })}
          </Folder>
          {legs.map((leg, i) => {
            const trace = traces[i]
            return (
              <Folder
                key={leg.txHash}
                title={`${labels[i]} ${leg.txHash.slice(0, 10)}…`}
                startClosed={leg.txHash !== props.txHash}
              >
                {trace?.isPending && <LoadingState />}
                {trace?.isError && (
                  <p className="pl-4 text-aux-red text-xs">
                    {(trace.error as Error).message}
                  </p>
                )}
                {trace?.data?.nodes
                  .filter((node) => node.parentId !== null)
                  .map((node) => (
                    <CallEntry
                      key={node.id}
                      txHash={leg.txHash}
                      nodeId={node.id}
                      depth={node.depth}
                      label={entryName(node.to, node.selector, workspace.data)}
                      workspace={workspace.data}
                      address={node.to}
                    />
                  ))}
              </Folder>
            )
          })}
        </li>
      </ol>
    </div>
  )
}

function sortLegs(legs: TraceWorkspaceLeg[]): TraceWorkspaceLeg[] {
  return legs.toSorted(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  )
}

/** Folder labels with victims (etc.) numbered when a role repeats. */
function legLabels(legs: TraceWorkspaceLeg[]): string[] {
  const roleCount = new Map<string, number>()
  for (const leg of legs) {
    roleCount.set(leg.role, (roleCount.get(leg.role) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return legs.map((leg) => {
    const label = ROLE_LABEL[leg.role] ?? leg.role
    if ((roleCount.get(leg.role) ?? 0) <= 1) return label
    const n = (seen.get(leg.role) ?? 0) + 1
    seen.set(leg.role, n)
    return `${label} ${n}`
  })
}

function entryName(
  to: string | null,
  selector: string | null,
  workspace: TraceWorkspace | undefined,
): string {
  // raw trace addresses are plain 0x… - toShortenedAddress expects eth:0x…
  const contract = to ? workspace?.contracts?.[to.toLowerCase()] : undefined
  const name =
    contract?.name || (to ? `${to.slice(0, 6)}…${to.slice(-4)}` : '(create)')
  const fn = selector ? (workspace?.selectors?.[selector] ?? selector) : undefined
  return fn ? `${name}.${fn}` : name
}

function Folder(props: {
  title: string
  startClosed?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!props.startClosed)
  return (
    <>
      <button
        onClick={() => setOpen((open) => !open)}
        className="flex min-h-[22px] w-full cursor-pointer select-none items-center gap-1 pl-2 font-medium text-coffee-400 text-sm hover:bg-aux-brown hover:text-coffee-200"
      >
        {open ? (
          <>
            <IconChevronDown />
            <IconFolderOpened />
          </>
        ) : (
          <>
            <IconChevronRight />
            <IconFolder />
          </>
        )}
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {props.title}
        </span>
      </button>
      {open && <ol>{props.children}</ol>}
    </>
  )
}

function CallEntry(props: {
  txHash: string
  nodeId: string
  label: string
  address: string | null
  workspace: TraceWorkspace | undefined
  depth?: number
}) {
  const select = usePanelStore((state) => state.select)
  const requestFocus = useTraceWorkspaceStore((state) => state.requestFocus)
  const focusRequest = useTraceWorkspaceStore((state) => state.focusRequest)
  const isFocused =
    focusRequest?.txHash === props.txHash && focusRequest?.nodeId === props.nodeId

  function onClick() {
    // panel-store selection is address-keyed (values/code/preview describe
    // contracts); the graph focus targets the concrete call node
    const contract = props.address
      ? props.workspace?.contracts?.[props.address.toLowerCase()]
      : undefined
    if (contract) select(contract.address)
    requestFocus(props.txHash, props.nodeId)
  }

  return (
    <li
      className={clsx(
        'flex min-h-[22px] cursor-pointer select-none items-center gap-1 whitespace-pre text-sm',
        isFocused && 'bg-autumn-300 text-black',
        !isFocused && 'bg-coffee-800 hover:bg-aux-brown',
      )}
      style={{ paddingLeft: `${16 + Math.min(props.depth ?? 0, 12) * 7}px` }}
      onClick={onClick}
    >
      <div className="mr-[7px] min-h-[22px] border-coffee-600 border-l" />
      <span className="overflow-hidden text-ellipsis tabular-nums">
        {props.label}
      </span>
    </li>
  )
}

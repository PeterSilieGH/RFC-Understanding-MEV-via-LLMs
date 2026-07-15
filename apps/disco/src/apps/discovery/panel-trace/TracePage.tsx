// DIVERGENCE(mev): new file. Deep-linked trace view (/ui/trace/:txHash).
//
// M4 rendered a lone full-screen TracePanel; with ADR-008 the deep link
// opens a full DiscoUI workspace docked around the incident's synthetic
// trace-<hash8> discovery project. The flow:
//   1. /ui/trace/:txHash resolves the workspace via trace-api (which kicks
//      off a bounded discovery run on first open). The graph renders
//      immediately - it needs no discovery - with a status ribbon while the
//      run is in flight.
//   2. When the project is ready the page redirects to
//      /ui/trace/:txHash/:project. The nested :project route param is what
//      lets the stock project-scoped panels (values/code/preview/terminal/…)
//      run byte-identical - they all resolve their project via useParams().
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { getTraceWorkspace } from '../../../api/traces'
import { Title } from '../../../components/Title'
import { findSelected } from '../../../utils/findSelected'
import { useProjectQueryOptions } from '../hooks/projectQuery'
import { MultiView } from '../multi-view/MultiView'
import { DockingStoreProvider, useTraceDockingStore } from '../multi-view/store'
import { usePanelStore } from '../store/panel-store'
import { TracePanel } from './TracePanel'

export function TracePage() {
  const { txHash, project } = useParams()

  // manual-input form (/ui/trace without a hash) stays the lone panel
  if (!txHash) {
    return (
      <>
        <Title title="DiscoUI - trace" />
        <div className="h-screen w-screen">
          <TracePanel />
        </div>
      </>
    )
  }

  if (project) {
    return <TraceWorkspace txHash={txHash} project={project} />
  }
  return <ResolveWorkspace txHash={txHash} />
}

/**
 * Full-screen graph while trace-api prepares the synthetic project; redirects
 * into the workspace when it is ready. On error the graph stays usable.
 */
function ResolveWorkspace(props: { txHash: string }) {
  const workspace = useQuery({
    queryKey: ['trace-workspace', props.txHash],
    queryFn: () => getTraceWorkspace(props.txHash),
    // trace-api holds one run per incident; polling is just status reads.
    // On 'error' polling stops - the panel below offers a manual retry
    // (a refetch re-kicks the run, trace-api drops failed state).
    refetchInterval: (query) =>
      query.state.data?.status === 'discovering' ? 2000 : false,
    retry: 1,
  })

  if (workspace.data?.status === 'ready') {
    return (
      <Navigate
        to={`/ui/trace/${props.txHash}/${workspace.data.project}`}
        replace
      />
    )
  }

  const status = workspace.isError
    ? `workspace unavailable: ${(workspace.error as Error).message}`
    : workspace.data?.status === 'error'
      ? `discovery failed: ${workspace.data.error ?? 'unknown error'}`
      : workspace.data?.status === 'discovering'
        ? `building contract workspace — discovering ${
            workspace.data.addressCount ?? '…'
          } contracts`
        : 'resolving incident…'
  const failed = workspace.isError || workspace.data?.status === 'error'

  return (
    <>
      <Title title="DiscoUI - trace" />
      <div className="flex h-screen w-screen flex-col">
        <div className="min-h-0 flex-1">
          <TracePanel key={props.txHash} initialTxHash={props.txHash} />
        </div>
        <div className="flex h-8 select-none items-center justify-between border-coffee-600 border-t px-2 text-xs">
          <span className={failed ? 'text-aux-red' : 'text-coffee-200'}>
            {status}
          </span>
          {failed && (
            <button
              className="border border-coffee-500 px-2 py-0.5 text-coffee-100 hover:bg-coffee-600"
              onClick={() => workspace.refetch()}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function TraceWorkspace(props: { txHash: string; project: string }) {
  // same initial-selection behavior as ProjectPage: select the first initial
  // contract of the (synthetic) project once it loads
  const response = useQuery(useProjectQueryOptions(props.project))
  const select = usePanelStore((state) => state.select)
  const selectedAddress = usePanelStore((state) => state.selected)
  useEffect(() => {
    if (response.data) {
      const stillExists = findSelected(response.data.entries, selectedAddress)
      if (!stillExists) {
        select(response.data.entries[0]?.initialContracts[0]?.address)
      }
    }
  }, [response.data, select, selectedAddress])

  return (
    <>
      <Title title={`DiscoUI - trace ${props.txHash.slice(0, 10)}…`} />
      <DockingStoreProvider value={useTraceDockingStore}>
        <MultiView project={props.project} />
      </DockingStoreProvider>
    </>
  )
}

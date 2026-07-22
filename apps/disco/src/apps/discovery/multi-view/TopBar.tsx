import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { traceWorkspaceQueryOptions } from '../../../api/traces'
import { Button } from '../../../components/Button'
import { IS_READONLY } from '../../../config/readonly'
import { IconClose } from '../../../icons/IconClose'
import { IconPlus } from '../../../icons/IconPlus'
import { IconRefresh } from '../../../icons/IconRefresh'
import { useTerminalStore } from '../panel-terminal/store'
import { useDiscoveryCommand } from '../panel-terminal/useDiscoveryCommand'
import { useResearchStore } from '../panel-agent/research-store'
import { Search } from '../search/Search'
import { SettingsDialog } from './SettingsDialog'
// DIVERGENCE(mev): store resolved via context so the trace workspace
// (ADR-008) reuses this bar against its own docking store
import { addPanel, useActiveDockingStore } from './store'

// DIVERGENCE(mev): in the trace workspace the bar shows the incident
// identity - the MEV type plus the short tx hash - instead of the synthetic
// project name (ADR-008, wp-trace-polish). The extracted-value figure was
// removed from the bar (ADR-013 §1); value lives on the explorer timeline and
// the Values/Discovery surfaces.
function useIncidentIdentity(): ReactNode | undefined {
  const { txHash } = useParams()
  const workspace = useQuery(traceWorkspaceQueryOptions(txHash))
  const legs = workspace.data?.legs ?? []
  if (!txHash) return undefined

  const viaTypes = legs
    .map((leg) => leg.viaType)
    .filter((t): t is string => t !== null)
  const kind = viaTypes.find((t) => t.startsWith('sandwich'))
    ? 'sandwich'
    : (viaTypes[0]?.split('_')[0] ?? 'trace')

  return (
    <p>
      {kind} · {`${txHash.slice(0, 10)}…`}
    </p>
  )
}

export function TopBar(props: { project: string }) {
  const useDockingStore = useActiveDockingStore()
  const incident = useIncidentIdentity()
  const layouts = useDockingStore((state) => state.layouts)
  const selectedLayout = useDockingStore((state) => state.selectedLayout)
  const loadLayout = useDockingStore((state) => state.loadLayout)
  const resetLayout = useDockingStore((state) => state.resetLayout)
  const { command } = useTerminalStore()
  const { killCommand, discover } = useDiscoveryCommand()
  const mevResearch = useResearchStore((state) => state.mev)
  const vulnResearch = useResearchStore((state) => state.vuln)
  const toggleResearch = useResearchStore((state) => state.toggle)

  // By default when using top bar
  const useDevMode = true

  return (
    <div className="select-none items-center justify-between px-2 max-md:invisible md:flex md:h-10">
      <div className="hidden items-center gap-2 md:flex">
        <Link to="/ui">
          <img className="-top-[3px] relative h-[20px]" src="/logo.svg" />
        </Link>
        {incident ?? <p>{props.project}</p>}
        <div className="border-coffee-400/30 border-l pl-3">
          <Search />
        </div>
      </div>
      <div className="hidden gap-3 md:flex">
        <div className="flex items-center gap-1 border-coffee-400/30 border-r pr-3">
          <button
            type="button"
            aria-pressed={mevResearch}
            onClick={() => toggleResearch('mev')}
            className={clsx(
              'rounded-sm border px-2 py-1 text-xs',
              mevResearch
                ? 'border-autumn-300 bg-autumn-300 text-black'
                : 'border-coffee-500 text-coffee-300',
            )}
          >
            MEV Research
          </button>
          <button
            type="button"
            aria-pressed={vulnResearch}
            onClick={() => toggleResearch('vuln')}
            className={clsx(
              'rounded-sm border px-2 py-1 text-xs',
              vulnResearch
                ? 'border-autumn-300 bg-autumn-300 text-black'
                : 'border-coffee-500 text-coffee-300',
            )}
          >
            Vulnerability Research
          </button>
        </div>
        {!IS_READONLY && (
          <div className="flex justify-center gap-1 border-coffee-400/30 border-r pr-3">
            <Button
              size="small"
              className="gap-1 rounded-sm"
              disabled={command.inFlight}
              onClick={() => discover(props.project, useDevMode)}
            >
              <IconRefresh className="size-3" />
              <span className="max-md:hidden">Discover</span>
            </Button>
            <Button
              size="small"
              variant="destructive"
              className="rounded-sm"
              disabled={!command.inFlight}
              onClick={killCommand}
            >
              <IconClose />
              <span className="max-md:hidden">Kill</span>
            </Button>
          </div>
        )}
        <div className="flex justify-center gap-1">
          <div className="inline-flex items-center gap-0.5 rounded-sm border border-coffee-400 bg-coffee-800/30 p-1">
            {layouts.map((_, i) => (
              <button
                key={i}
                className={clsx(
                  'flex size-5 items-center justify-center rounded-sm font-medium text-xs transition-all duration-100',
                  selectedLayout === i
                    ? 'bg-autumn-300 text-black shadow-sm'
                    : 'text-coffee-200 hover:bg-coffee-400/50 hover:text-coffee-100',
                )}
                onClick={() => loadLayout(i)}
                title={`Layout ${i + 1}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <Button
            size="small"
            className="rounded-sm"
            onClick={() => addPanel(useDockingStore)}
          >
            <IconPlus />
            <span className="max-lg:hidden">Panel</span>
          </Button>
          <Button
            size="small"
            className="rounded-sm"
            onClick={() => resetLayout()}
            title="Reset to default layout"
          >
            <span>Reset</span>
          </Button>
        </div>

        <div className="flex items-center gap-3 border-coffee-400/30 border-l pl-3">
          <SettingsDialog />
        </div>
      </div>
    </div>
  )
}

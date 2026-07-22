import { useEffect, useState } from 'react'
import { Checkbox } from '../../../components/Checkbox'
import { Dialog } from '../../../components/Dialog'
import { IconGear } from '../../../icons/IconGear'
import { useAgentModelStore } from '../panel-agent/model-store'
import { useGlobalSettingsStore } from '../store/global-settings-store'
import { AgentEffortSelect, AgentModelSelect } from './ModelSelect'

const MAX_DEPTH_LIMIT = 100

export function SettingsDialog() {
  const markUnreachableEntries = useGlobalSettingsStore(
    (s) => s.markUnreachableEntries,
  )
  const maxReachableDepth = useGlobalSettingsStore((s) => s.maxReachableDepth)
  const setUserSettings = useGlobalSettingsStore((s) => s.setUserSettings)

  // DIVERGENCE(mev): agent model selection lives here now (moved from the top
  // bar), split into independent Analyze and Discover phases.
  const analyzeModel = useAgentModelStore((s) => s.analyzeModel)
  const discoverModel = useAgentModelStore((s) => s.discoverModel)
  const analyzeEffort = useAgentModelStore((s) => s.analyzeEffort)
  const discoverEffort = useAgentModelStore((s) => s.discoverEffort)
  const setAnalyzeModel = useAgentModelStore((s) => s.setAnalyzeModel)
  const setDiscoverModel = useAgentModelStore((s) => s.setDiscoverModel)
  const setAnalyzeEffort = useAgentModelStore((s) => s.setAnalyzeEffort)
  const setDiscoverEffort = useAgentModelStore((s) => s.setDiscoverEffort)

  return (
    <Dialog.Root>
      <Dialog.Trigger aria-label="Global app settings">
        <IconGear />
      </Dialog.Trigger>
      <Dialog.Body>
        <Dialog.Title className="m-0 font-medium text-lg">
          Global app settings
        </Dialog.Title>
        <Dialog.Description className="mb-5 text-sm leading-normal">
          Change the way the app behaves.
        </Dialog.Description>

        <div className="flex flex-col">
          <h2 className="leading-none">Visuals</h2>
          <hr className="mt-1 mb-2 border-coffee-400/30" />
          <div>
            <div
              className="flex cursor-pointer select-none items-center gap-1 font-light text-sm hover:underline"
              onClick={() =>
                setUserSettings({
                  markUnreachableEntries: !markUnreachableEntries,
                })
              }
            >
              <Checkbox checked={markUnreachableEntries} />
              Make unreachable entries distinctive
            </div>
            <div className="flex items-center gap-1 pl-5 font-light text-coffee-400 text-xs">
              Entries unreachable from the root discovery will appear grayed
              out. <br />
              By default, all entries are displayed as if they were reachable.
            </div>
          </div>

          <h2 className="mt-4 leading-none">Reachability</h2>
          <hr className="mt-1 mb-2 border-coffee-400/30" />
          <DepthSelector
            value={maxReachableDepth}
            onChange={(v) => setUserSettings({ maxReachableDepth: v })}
          />

          <h2 className="mt-4 leading-none">Agent models</h2>
          <hr className="mt-1 mb-2 border-coffee-400/30" />
          <div className="flex flex-col gap-2">
            <AgentModelSelect
              label="Analyze"
              title="Model used for contract bundles, code/value review, and value enrichment"
              value={analyzeModel}
              onChange={setAnalyzeModel}
            />
            <AgentEffortSelect
              label="Analyze"
              value={analyzeEffort}
              onChange={setAnalyzeEffort}
            />
            <AgentModelSelect
              label="Discover"
              title="Model used to build Discovery verdicts and follow-up chat"
              value={discoverModel}
              onChange={setDiscoverModel}
            />
            <AgentEffortSelect
              label="Discover"
              value={discoverEffort}
              onChange={setDiscoverEffort}
            />
            <div className="font-light text-coffee-400 text-xs">
              Models come from agent-api (those with a working credential in the
              pi agent dir). Each defaults to the agent-api setting.
            </div>
          </div>
        </div>
      </Dialog.Body>
    </Dialog.Root>
  )
}

function DepthSelector(props: {
  value: number | null
  onChange: (value: number | null) => void
}) {
  const [text, setText] = useState(
    props.value === null ? '' : String(props.value),
  )
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    setText(props.value === null ? '' : String(props.value))
  }, [props.value])

  function commit(raw: string) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      setError(undefined)
      props.onChange(null)
      return
    }
    if (!/^\d+$/.test(trimmed)) {
      setError('Must be a non-negative integer')
      return
    }
    const parsed = Number(trimmed)
    if (parsed > MAX_DEPTH_LIMIT) {
      setError(`Must be at most ${MAX_DEPTH_LIMIT}`)
      return
    }
    setError(undefined)
    props.onChange(parsed)
  }

  return (
    <div>
      <label className="flex items-center gap-2 font-light text-sm">
        <span>Max reachable depth</span>
        <input
          type="number"
          min={0}
          max={MAX_DEPTH_LIMIT}
          step={1}
          value={text}
          placeholder="∞"
          onChange={(e) => {
            setText(e.target.value)
            commit(e.target.value)
          }}
          onBlur={(e) => commit(e.target.value)}
          className="w-20 border border-coffee-400/30 bg-coffee-700 px-2 py-0.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-autumn-300"
        />
      </label>
      <div className="pl-0 font-light text-coffee-400 text-xs">
        BFS depth from initial addresses used to mark entries reachable.
        <br />0 = only entrypoints (useful to surface bridge entries between
        discoveries). Empty = unlimited.
      </div>
      {error !== undefined && (
        <div className="pt-1 font-light text-red-400 text-xs">{error}</div>
      )}
    </div>
  )
}

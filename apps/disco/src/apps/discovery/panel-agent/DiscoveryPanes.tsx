// DIVERGENCE(mev): ADR-012 autonomous, typed Discovery surfaces. One shared
// preparation pass emits all active bundle kinds (jointly per unknown contract),
// then each kind gets its own selectable context and persistent conversation.
// ADR-013: research kinds are hideable tabs (§3), the follow-up input submits on
// Enter (§4), the bundle set is never inner-scrolled (§5), reasoning streams
// into a fixed-height output window (§6), and incident gas/tip context reaches
// the prep + verdict prompts (§7).
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  type AgentStreamEvent,
  type ContractBundle,
  getAgentModels,
  getDiscoverySession,
  type ResearchKind,
  streamDiscovery,
  streamPrepareBundles,
} from '../../../api/agent'
import { Button } from '../../../components/Button'
import { Checkbox } from '../../../components/Checkbox'
import { Loader } from '../../../components/Loader'
import { Markdown } from '../../../components/Markdown'
import { buildAutonomousContracts } from '../utils/panelContext'
import { useAgentModelStore } from './model-store'
import {
  activeResearchKinds,
  useResearchStore,
} from './research-store'
import {
  buildGasContext,
  buildSwapContext,
  buildTraceTreeContext,
} from './traceTree'
import { useAgentMarksStore } from './store'

const KIND_TITLE: Record<ResearchKind, string> = {
  mev: 'MEV Discovery',
  vuln: 'Vulnerability Discovery',
}

export function DiscoveryPanes(props: { project: string }) {
  const { project } = props
  const { txHash } = useParams()
  const research = useResearchStore()
  const kinds = activeResearchKinds(research)
  const model = useAgentModelStore((state) => state.incidentModel)
  const [bundles, setBundles] = useState<ContractBundle[]>([])
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<
    { address: string; message: string }[]
  >([])
  const abortRef = useRef<AbortController | undefined>(undefined)
  const addBundleMarks = useAgentMarksStore((state) => state.addBundleMarks)

  // ADR-013 §3: which kind's pane is shown, and whether it is collapsed. The
  // active kind is clamped to the currently-active research kinds on render.
  const [activeTab, setActiveTab] = useState<ResearchKind | undefined>(kinds[0])
  const [collapsed, setCollapsed] = useState(false)
  const activeKind =
    activeTab && kinds.includes(activeTab) ? activeTab : kinds[0]

  const prepare = useCallback(async () => {
    abortRef.current?.abort()
    if (kinds.length === 0) {
      setPreparing(false)
      setError(null)
      setWarnings([])
      setBundles([])
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setPreparing(true)
    setError(null)
    setWarnings([])
    setBundles([])
    try {
      const [contracts, gas] = await Promise.all([
        buildAutonomousContracts(project),
        buildGasContext(txHash),
      ])
      if (contracts.length === 0) throw new Error('No verified contract source is available')
      const stream = streamPrepareBundles(
        { project, kinds, contracts, gas, model },
        controller.signal,
      )
      const byKey = new Map<string, ContractBundle>()
      for await (const event of stream) {
        if (event.type === 'bundle') {
          byKey.set(`${event.bundle.codehash}:${event.bundle.kind}`, event.bundle)
          setBundles([...byKey.values()])
          setWarnings((current) =>
            current.filter(
              (warning) => !event.bundle.addresses.includes(warning.address),
            ),
          )
          addBundleMarks(project, event.bundle)
        } else if (event.type === 'warning') {
          setWarnings((current) => [
            ...current.filter((warning) => warning.address !== event.address),
            { address: event.address, message: event.message },
          ])
        } else if (event.type === 'error') {
          setError(event.message)
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message)
    } finally {
      if (!controller.signal.aborted) setPreparing(false)
    }
  }, [project, txHash, kinds.join(','), model?.provider, model?.id, addBundleMarks])

  useEffect(() => {
    void prepare()
    return () => abortRef.current?.abort()
  }, [prepare])

  return (
    <div className="flex flex-col border-coffee-600 border-b bg-coffee-800">
      {preparing && (
        <div className="flex items-center gap-2 p-2 text-coffee-400 text-xs">
          <Loader /> Preparing reusable bundles for the incident…
        </div>
      )}
      {error && (
        <div className="flex items-start justify-between gap-2 p-2">
          <pre className="whitespace-pre-wrap text-aux-red text-xs">{error}</pre>
          <Button size="small" onClick={() => void prepare()}>Retry</Button>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="flex items-start justify-between gap-2 p-2 text-xs">
          <div className="min-w-0 text-autumn-300">
            <p>{warnings.length} contract analysis run(s) could not be completed.</p>
            {warnings.map((warning) => (
              <p key={warning.address} className="truncate" title={warning.message}>
                {warning.address}: {warning.message}
              </p>
            ))}
          </div>
          <Button size="small" onClick={() => void prepare()}>Retry missing</Button>
        </div>
      )}
      {kinds.length === 0 && (
        <p className="p-2 text-coffee-400 text-xs italic">
          Select MEV Research or Vulnerability Research to prepare grounded bundles.
        </p>
      )}

      {/* ADR-013 §3: one tab per active kind. Clicking the active tab collapses
          it; clicking another selects it. */}
      {kinds.length > 0 && (
        <div className="flex items-stretch gap-px border-coffee-600 border-b bg-coffee-900">
          {kinds.map((kind) => {
            const isActive = kind === activeKind && !collapsed
            return (
              <button
                type="button"
                key={kind}
                aria-pressed={isActive}
                className={
                  isActive
                    ? 'border-autumn-300 border-b-2 px-3 py-1.5 font-bold text-coffee-100 text-xs uppercase'
                    : 'border-transparent border-b-2 px-3 py-1.5 text-coffee-300 text-xs uppercase hover:text-coffee-100'
                }
                onClick={() => {
                  if (kind === activeKind) {
                    setCollapsed((value) => !value)
                  } else {
                    setActiveTab(kind)
                    setCollapsed(false)
                  }
                }}
              >
                {KIND_TITLE[kind]}
              </button>
            )
          })}
        </div>
      )}

      {activeKind && !collapsed && (
        <DiscoveryKind
          key={activeKind}
          project={project}
          incident={txHash ?? project}
          txHash={txHash}
          kind={activeKind}
          bundles={bundles.filter((bundle) => bundle.kind === activeKind)}
          preparing={preparing}
        />
      )}
    </div>
  )
}

function DiscoveryKind(props: {
  project: string
  incident: string
  txHash: string | undefined
  kind: ResearchKind
  bundles: ContractBundle[]
  preparing: boolean
}) {
  const { project, incident, txHash, kind, bundles, preparing } = props
  const model = useAgentModelStore((state) => state.incidentModel)
  const models = useQuery({ queryKey: ['agent-models'], queryFn: getAgentModels })
  const stored = useQuery({
    queryKey: ['agent-discovery-session', project, incident, kind],
    queryFn: () => getDiscoverySession(project, incident, kind),
  })
  const [excluded, setExcluded] = useState<string[]>([])
  const [selectionDirty, setSelectionDirty] = useState(false)
  const [live, setLive] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [reasoningOpen, setReasoningOpen] = useState(true)
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [queued, setQueued] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | undefined>(undefined)

  const selected = bundles.filter((bundle) => !excluded.includes(bundle.codehash))
  const chosenModel = models.data?.models.find(
    (candidate) =>
      candidate.provider === (model?.provider ?? models.data?.default?.provider) &&
      candidate.id === (model?.id ?? models.data?.default?.id),
  )
  const contextWindow = chosenModel?.contextWindow ?? 128_000
  const baseTokens = 450
  const usedTokens = baseTokens + selected.reduce((sum, bundle) => sum + bundle.tokenEstimate, 0)
  const pct = Math.min(100, (usedTokens / contextWindow) * 100)

  const run = useCallback(
    async (followup?: string) => {
      if (running || selected.length === 0) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setRunning(true)
      setQueued(false)
      setError(null)
      setLive('')
      setReasoning('')
      let succeeded = true
      try {
        const [traceTree, swaps, gas] = await Promise.all([
          buildTraceTreeContext(txHash),
          buildSwapContext(txHash),
          buildGasContext(txHash),
        ])
        const stream = streamDiscovery(
          {
            project,
            incident,
            kind,
            codehashes: selected.map((bundle) => bundle.codehash),
            question: followup,
            traceTree,
            swaps,
            gas,
            model,
          },
          controller.signal,
        )
        for await (const event of stream) applyEvent(event)
        if (succeeded) {
          await stored.refetch()
          setSelectionDirty(false)
        }
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message)
      } finally {
        if (!controller.signal.aborted) setRunning(false)
      }

      function applyEvent(event: AgentStreamEvent) {
        if (event.type === 'delta') {
          setLive((value) => value + event.text)
          setQueued(false)
        } else if (event.type === 'reasoning') {
          setReasoning((value) => value + event.text)
          setQueued(false)
        } else if (event.type === 'queued') setQueued(true)
        else if (event.type === 'error') {
          succeeded = false
          setError(event.message)
        }
      }
    },
    [project, incident, kind, txHash, running, selected.map((b) => b.codehash).join(','), model?.provider, model?.id],
  )

  const submitFollowup = () => {
    const value = question.trim()
    if (running || !value) return
    setQuestion('')
    void run(value)
  }

  const turns = selectionDirty ? [] : (stored.data?.turns ?? [])
  return (
    <section className="flex flex-col gap-2 p-2">
      <div className="flex items-center justify-end">
        <Button
          size="small"
          variant="solid"
          disabled={preparing || running || selected.length === 0}
          onClick={() => void run()}
        >
          {turns.length > 0 ? 'Reassess' : 'Build verdict'}
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-coffee-400 text-[11px]">
          <span>Context: {usedTokens.toLocaleString()} / {contextWindow.toLocaleString()} tokens</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden bg-coffee-900">
          <div className="h-full bg-autumn-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* ADR-013 §5: every bundle is visible — no inner scrollbar. */}
      <div className="border border-coffee-600">
        {bundles.length === 0 && !preparing ? (
          <p className="p-2 text-coffee-400 text-xs italic">No {kind} bundles available.</p>
        ) : bundles.map((bundle) => {
          const checked = !excluded.includes(bundle.codehash)
          return (
            <button
              type="button"
              key={bundle.codehash}
              className="flex w-full items-start gap-2 border-coffee-700 border-b p-2 text-left text-xs hover:bg-coffee-700"
              onClick={() => {
                setSelectionDirty(true)
                setExcluded((current) =>
                  checked
                    ? [...current, bundle.codehash]
                    : current.filter((hash) => hash !== bundle.codehash),
                )
              }}
            >
              <Checkbox checked={checked} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{bundle.role}</span>
                <span className="text-coffee-400">{bundle.tokenEstimate} tokens · {bundle.addresses[0]}</span>
              </span>
            </button>
          )
        })}
      </div>

      {queued && <span className="text-coffee-400 text-xs">Queued behind another agent run…</span>}
      {error && <pre className="whitespace-pre-wrap text-aux-red text-xs">{error}</pre>}

      {/* ADR-013 §6: reasoning + verdict live in a fixed-height scroll window so
          a long verdict scrolls in place instead of growing the pane. */}
      {(reasoning || turns.length > 0 || (live && running)) && (
        <div className="h-64 overflow-auto border border-coffee-700 bg-coffee-900 p-2">
          {reasoning && (
            <div className="mb-2 border-coffee-700 border-b pb-2">
              <button
                type="button"
                className="text-coffee-400 text-[11px] uppercase hover:text-coffee-200"
                onClick={() => setReasoningOpen((value) => !value)}
              >
                {reasoningOpen ? '▾' : '▸'} Reasoning
              </button>
              {reasoningOpen && (
                <pre className="mt-1 whitespace-pre-wrap text-coffee-500 text-[11px] italic">
                  {reasoning}
                </pre>
              )}
            </div>
          )}
          {turns.map((turn, index) => (
            <div key={`${turn.role}-${index}`} className={turn.role === 'user' ? 'border-coffee-600 border-l-2 pl-2 text-coffee-400 text-xs' : 'text-xs'}>
              {turn.role === 'assistant' ? <Markdown allowHtml={false}>{turn.text}</Markdown> : turn.text}
            </div>
          ))}
          {live && running && <Markdown allowHtml={false}>{live}</Markdown>}
        </div>
      )}

      {turns.length > 0 && (
        // ADR-013 §4: Enter submits, Shift+Enter inserts a newline; no [Ask].
        <textarea
          className="min-h-10 w-full resize-y border border-coffee-600 bg-coffee-900 p-2 text-xs outline-none"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submitFollowup()
            }
          }}
          placeholder={`Ask a follow-up in this persistent ${kind} session… (Enter to send · Shift+Enter for newline)`}
        />
      )}
    </section>
  )
}

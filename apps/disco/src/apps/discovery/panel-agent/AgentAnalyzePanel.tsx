// DIVERGENCE(mev): new panel (ADR-009). Replaces the stock l2b analyzer UI and
// the disabled trace-workspace Analyze stub. Lists the pi-harness skills up
// front, takes one free-text question, and runs analyze-code / analyze-value
// against the nodes currently selected in the nodes view — streaming the
// report and marking covered nodes with the two ticks. Works on both the
// dependency-graph and trace-workspace routes (both expose :project and both
// sync graph selection into panel-store).
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  type AgentSkill,
  type AgentStreamEvent,
  getAgentSkills,
  streamAnalyze,
} from '../../../api/agent'
import { ActionNeededState } from '../../../components/ActionNeededState'
import { Button } from '../../../components/Button'
import { Loader } from '../../../components/Loader'
import { Markdown } from '../../../components/Markdown'
import { IconChevronDown } from '../../../icons/IconChevronDown'
import { IconChevronRight } from '../../../icons/IconChevronRight'
import { usePanelStore } from '../store/panel-store'
import {
  buildCodeContext,
  buildValueContext,
  resolveSelectedContracts,
} from '../utils/panelContext'
import { useAgentModelStore } from './model-store'
import { useAgentMarksStore } from './store'

/** eth:0x… / 0x… node addresses -> plain lowercase (matches agent_runs). */
function toPlain(address: string): string {
  return address.replace(/^[a-z]+:/i, '').toLowerCase()
}

export function AgentAnalyzePanel() {
  const { project } = useParams()
  const selected = usePanelStore((state) => state.selected)
  const highlighted = usePanelStore((state) => state.highlighted)

  // The nodes selected in the nodes view: multi-select `highlighted`, falling
  // back to the single `selected` address (populated on both routes).
  const addresses =
    highlighted.length > 0 ? highlighted : selected ? [selected] : []

  const skillsResponse = useQuery({
    queryKey: ['agent-skills'],
    queryFn: getAgentSkills,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const hydrate = useAgentMarksStore((s) => s.hydrate)
  useEffect(() => {
    if (project) void hydrate(project)
  }, [project, hydrate])

  if (!project) {
    return (
      <ActionNeededState message="Open a project or trace workspace to analyze its contracts" />
    )
  }

  return (
    <div className="flex h-full select-none flex-col gap-3 overflow-auto p-3 text-coffee-200">
      <SkillsIntro skills={skillsResponse.data ?? []} />
      <AnalyzeRunner
        project={project}
        addresses={addresses}
        skills={skillsResponse.data ?? []}
      />
    </div>
  )
}

function SkillsIntro(props: { skills: AgentSkill[] }) {
  // Foldable: the skill descriptions are useful once, then just take space —
  // collapsed by default after the first look would be ideal, but a persisted
  // default of "open" keeps discoverability. Toggles on header click.
  const [open, setOpen] = useState(true)
  return (
    <div className="flex flex-col gap-2 border border-coffee-600 bg-coffee-800 p-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 font-bold text-coffee-400 text-xs uppercase outline-none hover:text-coffee-200"
      >
        {open ? (
          <IconChevronDown className="size-3" />
        ) : (
          <IconChevronRight className="size-3" />
        )}
        Available skills
      </button>
      {open &&
        (props.skills.length === 0 ? (
          <p className="text-coffee-400 text-xs italic">Loading skills…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.skills.map((skill) => (
              <li key={skill.id} className="text-xs leading-relaxed">
                <span className="font-bold text-coffee-200">{skill.title}</span>
                {skill.context === 'transcripts' && (
                  <span className="ml-1 text-coffee-400">
                    (run from the Incident panel)
                  </span>
                )}
                <p className="text-coffee-400">{skill.description}</p>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

interface RunState {
  running: boolean
  skill: 'analyze-code' | 'analyze-value' | null
  report: string
  tools: string[]
  queued: boolean
  error: string | null
}

const IDLE: RunState = {
  running: false,
  skill: null,
  report: '',
  tools: [],
  queued: false,
  error: null,
}

function AnalyzeRunner(props: {
  project: string
  addresses: readonly string[]
  skills: AgentSkill[]
}) {
  const { project, addresses } = props
  const [question, setQuestion] = useState('')
  const [run, setRun] = useState<RunState>(IDLE)
  const abortRef = useRef<AbortController | null>(null)
  const addMarks = useAgentMarksStore((s) => s.addMarks)
  const model = useAgentModelStore((s) => s.analyzeModel)

  const targets = useQuery({
    queryKey: ['agent-targets', project, [...addresses].sort().join(',')],
    enabled: addresses.length > 0,
    queryFn: () => resolveSelectedContracts(project, addresses),
  })

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const start = useCallback(
    async (skill: 'analyze-code' | 'analyze-value') => {
      if (addresses.length === 0 || run.running) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setRun({ ...IDLE, running: true, skill })

      const plain = [...new Set(addresses.map(toPlain))]
      try {
        const codeContext = await buildCodeContext(project, addresses)
        const valueContext =
          skill === 'analyze-value'
            ? await buildValueContext(project, addresses)
            : undefined
        const stream = streamAnalyze(
          {
            project,
            skill,
            addresses: plain,
            question: question.trim() || undefined,
            // analyze-value ships code too, so the lookup tool stays available
            codeContext,
            valueContext,
            model,
          },
          controller.signal,
        )
        for await (const event of stream) {
          applyEvent(event, skill)
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setRun((r) => ({ ...r, error: (err as Error).message }))
        }
      } finally {
        // Always clear the spinner — a Stop (abort), an empty report (no
        // `saved` event), or a stream that ends without a terminal event would
        // otherwise leave the panel stuck "running" with its buttons disabled.
        if (abortRef.current === controller) {
          setRun((r) => ({ ...r, running: false, queued: false }))
        }
      }

      function applyEvent(
        event: AgentStreamEvent,
        activeSkill: 'analyze-code' | 'analyze-value',
      ) {
        switch (event.type) {
          case 'delta':
            setRun((r) => ({ ...r, report: r.report + event.text, queued: false }))
            break
          case 'tool':
            setRun((r) => ({ ...r, tools: [...r.tools, event.detail] }))
            break
          case 'queued':
            setRun((r) => ({ ...r, queued: true }))
            break
          case 'error':
            setRun((r) => ({ ...r, running: false, error: event.message }))
            break
          case 'saved':
            setRun((r) => ({ ...r, running: false }))
            addMarks(project, activeSkill, plain)
            break
          case 'done':
            // report already accumulated from deltas; wait for `saved`
            break
        }
      }
    },
    [addresses, project, question, run.running, addMarks, model],
  )

  const disabled = addresses.length === 0 || run.running

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="font-bold text-coffee-400 text-xs uppercase">
          Selected nodes ({addresses.length})
        </div>
        {addresses.length === 0 ? (
          <p className="text-coffee-400 text-xs italic">
            Select one or more nodes in the graph to analyze them.
          </p>
        ) : (
          <ul className="max-h-24 overflow-auto text-xs">
            {(targets.data ?? []).map((c) => (
              <li key={c.address} className="truncate font-mono text-coffee-200">
                {c.name ?? c.address}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="font-bold text-coffee-400 text-xs uppercase">
          Question
        </div>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask the MEV expert something specific about the selected contracts…"
          className="min-h-16 resize-y select-text border border-coffee-600 bg-coffee-800 p-2 text-coffee-200 text-xs outline-none placeholder:text-coffee-400 focus:border-coffee-400"
        />
      </div>

      <div className="flex gap-1">
        <Button
          size="small"
          variant="solid"
          disabled={disabled}
          onClick={() => start('analyze-code')}
        >
          Analyze code
        </Button>
        <Button
          size="small"
          variant="solid"
          disabled={disabled}
          onClick={() => start('analyze-value')}
        >
          Analyze value
        </Button>
        {run.running && (
          <Button size="small" onClick={() => abortRef.current?.abort()}>
            Stop
          </Button>
        )}
      </div>

      <ResultView run={run} />
    </div>
  )
}

function ResultView(props: { run: RunState }) {
  const { run } = props
  if (!run.skill && !run.report && !run.error) {
    return (
      <div className="min-h-0 flex-1 select-text overflow-auto border border-coffee-600 bg-coffee-800 p-2">
        <p className="text-coffee-400 text-xs italic">
          Run a skill on the selected nodes to see the expert report here.
        </p>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 select-text flex-col gap-2 overflow-auto border border-coffee-600 bg-coffee-800 p-2">
      {run.queued && (
        <div className="flex items-center gap-2 text-coffee-400 text-xs">
          <Loader />
          Queued behind another analysis…
        </div>
      )}
      {run.tools.length > 0 && (
        <div className="text-coffee-400 text-xs">
          {run.tools.map((t, i) => (
            <div key={i} className="font-mono">
              · {t}
            </div>
          ))}
        </div>
      )}
      {run.error ? (
        <pre className="whitespace-pre-wrap break-all font-mono text-aux-red text-xs">
          {run.error}
        </pre>
      ) : (
        <Markdown allowHtml={false} className="text-coffee-200 text-sm leading-relaxed">
          {run.report}
        </Markdown>
      )}
      {run.running && !run.queued && (
        <div className="flex items-center gap-2 text-coffee-400 text-xs">
          <Loader />
          {run.skill === 'analyze-code' ? 'Analyzing code…' : 'Analyzing value…'}
        </div>
      )}
    </div>
  )
}

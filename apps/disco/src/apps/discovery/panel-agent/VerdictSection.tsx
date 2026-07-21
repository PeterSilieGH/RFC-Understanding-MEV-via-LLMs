// DIVERGENCE(mev): new file (ADR-009). The Preview panel's agentic verdict:
// a button that runs the build-preview skill (combining the stored analyze
// transcripts into one verdict about the transaction, or the whole bundle for
// a multi-tx incident) and the latest stored verdict rendered above the stock
// preview. The per-analysis transcripts themselves are never shown here.
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  type AgentStreamEvent,
  getAgentVerdict,
  streamVerdict,
} from '../../../api/agent'
import { Button } from '../../../components/Button'
import { Loader } from '../../../components/Loader'
import { Markdown } from '../../../components/Markdown'
import { useAgentModelStore } from './model-store'
import { marksFor, useAgentMarksStore } from './store'
import { buildSwapContext, buildTraceTreeContext } from './traceTree'
import { VerdictChat } from './VerdictChat'

export function VerdictSection(props: { project: string }) {
  const { project } = props
  // txHash is present on the trace-workspace route; it lets us ship the
  // incident's structural call tree to the verdict (ADR-009).
  const { txHash } = useParams()
  const [live, setLive] = useState('')
  const [running, setRunning] = useState(false)
  const [queued, setQueued] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const model = useAgentModelStore((s) => s.incidentModel)
  const setImportant = useAgentMarksStore((s) => s.setImportant)

  const stored = useQuery({
    queryKey: ['agent-verdict', project],
    queryFn: () => getAgentVerdict(project),
  })

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const build = useCallback(async () => {
    if (running) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setQueued(false)
    setError(null)
    setLive('')

    const marks = marksFor(useAgentMarksStore.getState(), project)
    const analyzed = [...new Set([...marks.code, ...marks.value])]
    const [traceTree, swaps] = await Promise.all([
      buildTraceTreeContext(txHash),
      buildSwapContext(txHash),
    ])

    try {
      const stream = streamVerdict(
        { project, model, traceTree, swaps, analyzed },
        controller.signal,
      )
      for await (const event of stream) {
        applyEvent(event)
      }
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message)
    } finally {
      setRunning(false)
    }

    function applyEvent(event: AgentStreamEvent) {
      switch (event.type) {
        case 'delta':
          setLive((t) => t + event.text)
          setQueued(false)
          break
        case 'queued':
          setQueued(true)
          break
        case 'flagged':
          setImportant(project, event.addresses)
          break
        case 'error':
          setError(event.message)
          break
        case 'saved':
          void stored.refetch()
          break
        case 'done':
        case 'tool':
          break
      }
    }
  }, [project, running, stored, model, txHash, setImportant])

  const verdict = stored.data
  const showLive = running || (live && !verdict)

  return (
    <div className="flex flex-col gap-2 border-coffee-600 border-b bg-coffee-800 p-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-coffee-400 text-xs uppercase">
          MEV verdict
        </span>
        <Button size="small" variant="solid" disabled={running} onClick={build}>
          {verdict ? 'Rebuild verdict' : 'Build verdict'}
        </Button>
      </div>

      {queued && (
        <div className="flex items-center gap-2 text-coffee-400 text-xs">
          <Loader />
          Queued behind another analysis…
        </div>
      )}

      {error && (
        <pre className="whitespace-pre-wrap break-words font-mono text-aux-red text-xs">
          {error}
        </pre>
      )}

      {showLive ? (
        <Markdown allowHtml={false} className="text-coffee-200 text-sm leading-relaxed">
          {live}
        </Markdown>
      ) : verdict ? (
        <div className="flex flex-col gap-1">
          <Markdown allowHtml={false} className="text-coffee-200 text-sm leading-relaxed">
            {verdict.report}
          </Markdown>
          <span className="text-coffee-400 text-xs">
            {new Date(verdict.createdAt).toLocaleString()}
          </span>
        </div>
      ) : (
        !running &&
        !error && (
          <p className="text-coffee-400 text-xs italic">
            No verdict yet. Run Analyze code / Analyze value on the incident's
            contracts, then build a verdict from their transcripts.
          </p>
        )
      )}

      {running && !queued && (
        <div className="flex items-center gap-2 text-coffee-400 text-xs">
          <Loader />
          Building verdict…
        </div>
      )}

      {verdict && !showLive && (
        <VerdictChat project={project} txHash={txHash} model={model} />
      )}
    </div>
  )
}

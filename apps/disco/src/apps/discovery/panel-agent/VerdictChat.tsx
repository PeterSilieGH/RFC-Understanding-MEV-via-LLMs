// DIVERGENCE(mev): new file (ADR-009). Follow-up chat under the Incident
// verdict. agent-api is stateless — the session that produced the verdict is
// gone — so this holds the conversation client-side and re-sends it (plus the
// incident's trace tree + decoded swaps) on every turn; the server rebuilds the
// verdict's context from the stored report + transcripts and answers grounded
// in that same evidence. Answers are ephemeral (never persisted as runs).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AgentModelRef,
  type AgentStreamEvent,
  streamVerdictChat,
  type VerdictChatTurn,
} from '../../../api/agent'
import { Button } from '../../../components/Button'
import { Loader } from '../../../components/Loader'
import { Markdown } from '../../../components/Markdown'
import { buildSwapContext, buildTraceTreeContext } from './traceTree'

interface Turn extends VerdictChatTurn {
  /** true while the assistant turn is still streaming */
  pending?: boolean
}

export function VerdictChat(props: {
  project: string
  txHash: string | undefined
  model: AgentModelRef | undefined
}) {
  const { project, txHash, model } = props
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The incident context (trace tree + swaps) is the same for every follow-up,
  // so build it once per txHash instead of re-fetching on each turn.
  const contextRef = useRef<
    { txHash?: string; traceTree: string; swaps: string } | undefined
  >(undefined)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const send = useCallback(async () => {
    const question = input.trim()
    if (!question || running) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setInput('')

    // history = everything already exchanged (before this new question)
    const history: VerdictChatTurn[] = turns.map((t) => ({
      role: t.role,
      text: t.text,
    }))
    setTurns((t) => [
      ...t,
      { role: 'user', text: question },
      { role: 'assistant', text: '', pending: true },
    ])
    setRunning(true)

    if (contextRef.current?.txHash !== txHash) {
      const [traceTree, swaps] = await Promise.all([
        buildTraceTreeContext(txHash),
        buildSwapContext(txHash),
      ])
      contextRef.current = { txHash, traceTree, swaps }
    }
    const ctx = contextRef.current

    try {
      const stream = streamVerdictChat(
        {
          project,
          model,
          question,
          history,
          traceTree: ctx?.traceTree,
          swaps: ctx?.swaps,
        },
        controller.signal,
      )
      for await (const event of stream) {
        applyEvent(event)
      }
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message)
    } finally {
      if (abortRef.current === controller) {
        setRunning(false)
        setTurns((t) =>
          t.map((turn) => (turn.pending ? { ...turn, pending: false } : turn)),
        )
      }
    }

    function applyEvent(event: AgentStreamEvent) {
      switch (event.type) {
        case 'delta':
          setTurns((t) => appendToLast(t, event.text))
          break
        case 'error':
          setError(event.message)
          break
        case 'queued':
        case 'tool':
        case 'done':
        case 'saved':
        case 'flagged':
          break
      }
    }
  }, [input, running, turns, project, model, txHash])

  function onKeyDown(event: React.KeyboardEvent) {
    // Enter sends; Shift+Enter inserts a newline
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex flex-col gap-2 border-coffee-600 border-t pt-2">
      <span className="font-bold text-coffee-400 text-xs uppercase">
        Ask a follow-up
      </span>

      {turns.length > 0 && (
        <div className="flex flex-col gap-2">
          {turns.map((turn, i) => (
            <div
              key={i}
              className={
                turn.role === 'user'
                  ? 'border-coffee-600 border-l-2 pl-2 text-coffee-300 text-xs'
                  : 'text-coffee-200 text-sm'
              }
            >
              {turn.role === 'user' ? (
                <span className="whitespace-pre-wrap break-words">{turn.text}</span>
              ) : turn.text ? (
                <Markdown allowHtml={false} className="leading-relaxed">
                  {turn.text}
                </Markdown>
              ) : (
                turn.pending && (
                  <span className="flex items-center gap-2 text-coffee-400 text-xs">
                    <Loader />
                    Thinking…
                  </span>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <pre className="whitespace-pre-wrap break-words font-mono text-aux-red text-xs">
          {error}
        </pre>
      )}

      <div className="flex flex-col gap-1">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a follow-up about this verdict…"
          className="min-h-12 resize-y select-text border border-coffee-600 bg-coffee-900 p-2 text-coffee-200 text-xs outline-none placeholder:text-coffee-400 focus:border-coffee-400"
        />
        <div className="flex gap-1">
          <Button
            size="small"
            variant="solid"
            disabled={running || input.trim().length === 0}
            onClick={() => void send()}
          >
            Ask
          </Button>
          {running && (
            <Button size="small" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Append streamed text to the last (assistant) turn. */
function appendToLast(turns: Turn[], text: string): Turn[] {
  if (turns.length === 0) return turns
  const last = turns[turns.length - 1]
  if (!last || last.role !== 'assistant') return turns
  return [
    ...turns.slice(0, -1),
    { ...last, text: last.text + text, pending: true },
  ]
}

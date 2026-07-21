// Client for agent-api (ADR-009), reached through the disco-web nginx proxy at
// /api/agent/. analyze + verdict stream NDJSON (one JSON event per line) read
// via fetch streaming — EventSource is GET-only and these need a request body.

export type AgentSkillId = 'analyze-code' | 'analyze-value' | 'build-preview'

export interface AgentSkill {
  id: AgentSkillId
  title: string
  description: string
  context: 'code' | 'values' | 'transcripts'
}

export type AgentStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'queued' }
  | { type: 'flagged'; addresses: string[] }
  | { type: 'done'; report: string; transcript: string }
  | { type: 'saved'; id: number }
  | { type: 'error'; message: string }
  | { type: 'warning'; address: string; message: string }
  | { type: 'bundle'; bundle: ContractBundle }
  | { type: 'prepared' }
  | { type: 'session'; session: DiscoverySession }
  | { type: 'enrichment'; id: number; config: string; template: string | null }

export interface AgentRunSummary {
  id: number
  skill: AgentSkillId
  addresses: string[]
  createdAt: string
}

export interface AgentVerdict {
  id: number
  report: string
  createdAt: string
}

export interface AgentModelRef {
  provider: string
  id: string
}

export interface AgentModel extends AgentModelRef {
  label: string
  contextWindow: number
}

export type ResearchKind = 'mev' | 'vuln'

export interface ContractBundle {
  codehash: string
  kind: ResearchKind
  addresses: string[]
  role: string
  entryPoints: string[]
  flowSummary: string
  notes: string
  tokenEstimate: number
  provenanceRunId: number | null
  createdAt: string
  updatedAt: string
}

export interface BundleContractInput {
  address: string
  name?: string
  codeContext: string
  valueContext?: string
}

export interface DiscoveryTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface DiscoverySession {
  project: string
  incident: string
  kind: ResearchKind
  bundleFingerprint: string
  turns: DiscoveryTurn[]
  updatedAt: string
}

export async function getAgentSkills(): Promise<AgentSkill[]> {
  const res = await fetch('/api/agent/skills')
  if (!res.ok) throw new Error(res.statusText)
  const data = (await res.json()) as { skills: AgentSkill[] }
  return data.skills
}

export async function getAgentModels(): Promise<{
  models: AgentModel[]
  default: AgentModelRef | null
}> {
  const res = await fetch('/api/agent/models')
  if (!res.ok) throw new Error(res.statusText)
  return (await res.json()) as { models: AgentModel[]; default: AgentModelRef | null }
}

export async function getAgentRuns(
  project: string,
): Promise<{ runs: AgentRunSummary[]; verdict: AgentVerdict | null }> {
  const res = await fetch(`/api/agent/runs?project=${encodeURIComponent(project)}`)
  if (!res.ok) throw new Error(res.statusText)
  return (await res.json()) as { runs: AgentRunSummary[]; verdict: AgentVerdict | null }
}

export async function getAgentVerdict(project: string): Promise<AgentVerdict | null> {
  const res = await fetch(`/api/agent/verdict?project=${encodeURIComponent(project)}`)
  if (!res.ok) throw new Error(res.statusText)
  const data = (await res.json()) as { verdict: AgentVerdict | null }
  return data.verdict
}

export interface AnalyzeRequest {
  project: string
  skill: 'analyze-code' | 'analyze-value'
  addresses: string[]
  question?: string
  codeContext?: string
  valueContext?: string
  /** model override from the top-bar picker; omit for the settings default */
  model?: AgentModelRef
}

/** POST /api/agent/analyze and yield each NDJSON event as it streams. */
export function streamAnalyze(
  req: AnalyzeRequest,
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  return streamNdjson('/api/agent/analyze', req, signal)
}

export function streamPrepareBundles(
  req: {
    project: string
    kinds: ResearchKind[]
    contracts: BundleContractInput[]
    model?: AgentModelRef
  },
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  return streamNdjson('/api/agent/bundles/prepare', req, signal)
}

export function streamDiscovery(
  req: {
    project: string
    incident?: string
    kind: ResearchKind
    codehashes: string[]
    question?: string
    traceTree?: string
    swaps?: string
    model?: AgentModelRef
    reset?: boolean
  },
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  return streamNdjson('/api/agent/discovery', req, signal)
}

export function streamValueEnrichment(
  req: {
    project: string
    address: string
    config: string
    template?: string
    codeContext: string
    valueContext?: string
    model?: AgentModelRef
  },
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  return streamNdjson('/api/agent/values/enrich', req, signal)
}

export async function getDiscoverySession(
  project: string,
  incident: string,
  kind: ResearchKind,
): Promise<DiscoverySession | null> {
  const query = new URLSearchParams({ project, incident, kind })
  const res = await fetch(`/api/agent/discovery/session?${query}`)
  if (!res.ok) throw new Error(res.statusText)
  return ((await res.json()) as { session: DiscoverySession | null }).session
}

export interface VerdictRequest {
  project: string
  model?: AgentModelRef
  /** compact call-tree (signatures + links) for the incident, when on a trace route */
  traceTree?: string
  /** decoded swaps per leg (protocol, pool, token amounts in/out) */
  swaps?: string
  /** addresses already covered by analyze-code / analyze-value */
  analyzed?: string[]
}

/** POST /api/agent/verdict and yield each NDJSON event as it streams. */
export function streamVerdict(
  req: VerdictRequest,
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  return streamNdjson('/api/agent/verdict', req, signal)
}

/** One turn of the verdict follow-up conversation (ADR-009). */
export interface VerdictChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface VerdictChatRequest {
  project: string
  model?: AgentModelRef
  /** the user's follow-up question */
  question: string
  /** the conversation so far (prior questions + answers), for grounding */
  history?: VerdictChatTurn[]
  /** same incident context the verdict saw, so follow-ups stay grounded */
  traceTree?: string
  swaps?: string
}

/**
 * POST /api/agent/verdict/chat: ask a follow-up about the stored verdict.
 * agent-api stays stateless (ADR-009) — the session that produced the verdict
 * is gone, so the server reconstructs context from the stored verdict report,
 * the analyze transcripts, and the conversation history sent here.
 */
export function streamVerdictChat(
  req: VerdictChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  return streamNdjson('/api/agent/verdict/chat', req, signal)
}

async function* streamNdjson(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let message = res.statusText
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // non-JSON error body — keep statusText
    }
    yield { type: 'error', message }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) yield JSON.parse(line) as AgentStreamEvent
      newline = buffer.indexOf('\n')
    }
  }
  const tail = buffer.trim()
  if (tail) yield JSON.parse(tail) as AgentStreamEvent
}

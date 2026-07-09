// DIVERGENCE(mev): trace endpoints live on our trace-api, not the DiscoUI
// backend - the dev proxy / nginx route /api/traces there (ADR-004/005).
import type { TraceGraph } from '@mev/trace-graph'

export async function getTraceGraph(txHash: string): Promise<TraceGraph> {
  const res = await fetch(`/api/traces/${txHash}/graph`)
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new Error(body?.error ?? res.statusText)
  }
  return res.json()
}

// DIVERGENCE(mev): ADR-017 §4 — flagged incidents are stored by explorer-api
// (reached through the disco nginx `/api/flagged` proxy) so they surface in the
// Explorer "Flagged TXs" view across the two origins.

export interface FlaggedTx {
  txHash: string
  project: string | null
  blockNumber: number | null
  label: string | null
  note: string | null
  createdAt: string
}

export interface FlagTxInput {
  txHash: string
  project?: string | null
  blockNumber?: number | null
  label?: string | null
  note?: string | null
}

export async function getFlagged(): Promise<FlaggedTx[]> {
  const res = await fetch('/api/flagged')
  if (!res.ok) throw new Error(res.statusText)
  const body = (await res.json()) as { flagged: FlaggedTx[] }
  return body.flagged
}

/** One canonical React Query key/options contract for flagged consumers. */
export function flaggedQueryOptions() {
  return {
    queryKey: ['flagged'] as const,
    queryFn: getFlagged,
    staleTime: 30_000,
  }
}

export async function flagTx(input: FlagTxInput): Promise<FlaggedTx> {
  const res = await fetch('/api/flagged', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new Error(body?.error ?? res.statusText)
  }
  const body = (await res.json()) as { flagged: FlaggedTx }
  return body.flagged
}

export async function unflagTx(txHash: string): Promise<void> {
  const res = await fetch(`/api/flagged/${txHash}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(res.statusText)
}

// DIVERGENCE(mev): trace endpoints live on our trace-api, MEV facts on our
// explorer-api - not the DiscoUI backend. The dev proxy / nginx route
// /api/traces + /api/contracts to trace-api and /api/mev to explorer-api
// (ADR-004/005/007).
import type { TraceGraph } from '@mev/trace-graph'

export async function getTraceGraph(txHash: string): Promise<TraceGraph> {
  const res = await fetch(`/api/traces/${txHash}/graph`)
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new Error(body?.error ?? res.statusText)
  }
  return res.json()
}

/** One canonical React Query key/options contract for every trace consumer. */
export function traceGraphQueryOptions(txHash: string | undefined) {
  return {
    queryKey: ['traces', txHash] as const,
    queryFn: () => getTraceGraph(txHash ?? ''),
    enabled: !!txHash,
    staleTime: Number.POSITIVE_INFINITY,
  }
}

// --- MEV enrichment (explorer-api /api/mev/tx/:hash, M4) --------------------

export interface FormattedAmount {
  value: number
  symbol: string
  tokenAddress?: string | null
}

/**
 * One entry of a transaction's merged mev[] array. Fields differ per
 * detector type (see explorer-api mev.ts) - only the ones the trace view
 * renders are typed here.
 */
export interface TxMevEntry {
  type: string
  error?: string | null
  profit?: FormattedAmount | null
  received?: FormattedAmount | null
  counterpartTxHash?: string
  victimTxHashes?: string[]
  winnerTxHash?: string
  loserTxHashes?: string[]
  reverseTxHash?: string | null
  [key: string]: unknown
}

export interface TxSwap {
  protocol: string | null
  contractAddress: string
  /** mev-inspect trace path, joins onto trace-graph node ids when dotted. */
  traceAddress: number[]
  error: string | null
  tokenIn?: FormattedAmount | null
  tokenOut?: FormattedAmount | null
}

export interface TxMev {
  inspected: boolean
  blockNumber: number | null
  transaction: {
    hash: string
    from: string | null
    to: string | null
    /** decimal-wei strings from miner_payments (explorer-api mev.ts). */
    coinbaseTransferWei?: string | null
    gasPriceWei?: string | null
    gasUsed?: string | null
    baseFeePerGasWei?: string | null
    swaps: TxSwap[]
    mev: TxMevEntry[]
  } | null
}

export async function getTxMev(txHash: string): Promise<TxMev> {
  const res = await fetch(`/api/mev/tx/${txHash}`)
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new Error(body?.error ?? res.statusText)
  }
  return res.json()
}

// --- Trace workspace (trace-api, synthetic trace-<hash8> projects, ADR-008) -

export interface TraceWorkspaceLeg {
  txHash: string
  /** Absolute role within the incident (List folder names, ADR-008). */
  role: 'frontrun' | 'backrun' | 'victim' | 'winner' | 'loser' | 'counterpart' | 'root'
  viaType: string | null
}

export interface TraceWorkspace {
  project: string
  status: 'discovering' | 'ready' | 'error'
  legs: TraceWorkspaceLeg[]
  addressCount: number | null
  error: string | null
  /** Present when ready: lowercase 0x address -> discovered name + eth: address. */
  contracts?: Record<string, { name: string | null; address: string }>
  /** Present when ready: 4-byte selector -> function name from discovered ABIs. */
  selectors?: Record<string, string>
  /** Incident snapshot resolved by trace-api (ADR-008/016). */
  snapshot?: { blockNumber: number; blockHash: string; timestamp: number }
}

export function traceWorkspaceQueryOptions(txHash: string | undefined) {
  return {
    queryKey: ['trace-workspace', txHash],
    queryFn: () => getTraceWorkspace(txHash ?? ''),
    enabled: !!txHash,
  }
}

/**
 * Resolve the incident and report (or kick off) its synthetic discovery
 * project. First call starts a bounded discovery run; poll while
 * status === 'discovering'.
 */
export async function getTraceWorkspace(txHash: string): Promise<TraceWorkspace> {
  const res = await fetch(`/api/traces/${txHash}/workspace`)
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new Error(body?.error ?? res.statusText)
  }
  return res.json()
}

// --- Contract sources (trace-api /api/contracts, Etherscan-backed) ----------

export interface ContractCode {
  address: string
  entryName: string
  sources: { name: string; code: string }[]
}

export async function getTraceContractCode(address: string): Promise<ContractCode> {
  const res = await fetch(`/api/contracts/${address}/code`)
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new Error(body?.error ?? res.statusText)
  }
  return res.json()
}

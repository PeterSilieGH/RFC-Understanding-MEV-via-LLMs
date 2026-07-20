// DIVERGENCE(mev): compact call-tree context for the build-verdict skill
// (ADR-009). The verdict runs over the stored analyze transcripts, but those
// only cover the contracts the user analyzed — to judge structure (and to spot
// important-but-unanalyzed contracts) the model also needs the shape of the
// incident. We ship a signatures-and-links tree, deliberately NOT the full
// calldata/state, so large MEV traces stay within the prompt budget.
import {
  type FormattedAmount,
  getTraceGraph,
  getTraceWorkspace,
  getTxMev,
} from '../../../api/traces'

/** Cap per leg so a pathological trace can't blow the prompt budget. */
const MAX_NODES_PER_LEG = 400

function short(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-4)}`
}

/**
 * Build a depth-indented call tree for every leg of the incident behind
 * `txHash`, naming contracts and selectors from the discovery output. Returns
 * an empty string when there is no trace to describe (e.g. a plain project
 * route or a trace that failed to load) — the verdict just runs without it.
 */
export async function buildTraceTreeContext(
  txHash: string | undefined,
): Promise<string> {
  if (!txHash) return ''
  let workspace: Awaited<ReturnType<typeof getTraceWorkspace>>
  try {
    workspace = await getTraceWorkspace(txHash)
  } catch {
    return ''
  }
  const contracts = workspace.contracts ?? {}
  const selectors = workspace.selectors ?? {}
  const legs = workspace.legs.length > 0 ? workspace.legs : [{ txHash, role: 'root' as const, viaType: null }]

  const nameFor = (address: string | null): string => {
    if (!address) return '(create)'
    const hit = contracts[address.toLowerCase()]
    return hit?.name ?? short(address)
  }
  const fnFor = (selector: string | null): string => {
    if (!selector) return '(fallback)'
    return selectors[selector.toLowerCase()] ?? selector
  }

  const sections: string[] = []
  for (const leg of legs) {
    let graph: Awaited<ReturnType<typeof getTraceGraph>>
    try {
      graph = await getTraceGraph(leg.txHash)
    } catch {
      continue
    }
    const lines: string[] = []
    for (const node of graph.nodes.slice(0, MAX_NODES_PER_LEG)) {
      const indent = '  '.repeat(node.depth)
      const kind = node.type === 'CALL' ? '' : `${node.type} `
      const err = node.error ? ' [revert]' : ''
      const to = node.to ?? '(create)'
      lines.push(`${indent}${kind}${nameFor(node.to)}.${fnFor(node.selector)}${err}  ${to}`)
    }
    if (graph.nodes.length > MAX_NODES_PER_LEG) {
      lines.push(`  …(${graph.nodes.length - MAX_NODES_PER_LEG} more calls omitted)`)
    }
    sections.push(`# Leg ${leg.role} (${short(leg.txHash)})\n${lines.join('\n')}`)
  }
  return sections.join('\n\n')
}

function amount(a: FormattedAmount | null | undefined): string {
  if (!a) return '?'
  return `${a.value} ${a.symbol}`
}

/**
 * DIVERGENCE(mev): the decoded swaps of every leg (protocol, pool, and the
 * token amounts in/out), so the verdict can reason about value flow — direction,
 * sizes, and imbalances — that the structural trace tree alone doesn't carry
 * (ADR-009). Sourced from the explorer's per-tx MEV facts (getTxMev). Returns
 * '' when there are no decoded swaps (uninspected block, plain transfer, …).
 */
export async function buildSwapContext(
  txHash: string | undefined,
): Promise<string> {
  if (!txHash) return ''
  let workspace: Awaited<ReturnType<typeof getTraceWorkspace>>
  try {
    workspace = await getTraceWorkspace(txHash)
  } catch {
    return ''
  }
  const contracts = workspace.contracts ?? {}
  const legs =
    workspace.legs.length > 0
      ? workspace.legs
      : [{ txHash, role: 'root' as const, viaType: null }]

  const nameFor = (address: string): string =>
    contracts[address.toLowerCase()]?.name ?? short(address)

  const sections: string[] = []
  for (const leg of legs) {
    let mev: Awaited<ReturnType<typeof getTxMev>>
    try {
      mev = await getTxMev(leg.txHash)
    } catch {
      continue
    }
    const swaps = mev.transaction?.swaps ?? []
    if (swaps.length === 0) continue
    const lines = swaps.map((s) => {
      const path = s.traceAddress.length === 0 ? 'root' : s.traceAddress.join('.')
      const err = s.error ? ' [revert]' : ''
      return `- [${path}] ${s.protocol ?? 'swap'} @ ${nameFor(s.contractAddress)}: ${amount(s.tokenIn)} → ${amount(s.tokenOut)}${err}`
    })
    sections.push(`# Leg ${leg.role} (${short(leg.txHash)})\n${lines.join('\n')}`)
  }
  return sections.join('\n\n')
}

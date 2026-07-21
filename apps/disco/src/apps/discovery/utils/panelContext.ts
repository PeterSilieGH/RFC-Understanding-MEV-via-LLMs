// DIVERGENCE(mev): shared "copy panel context" formatting (ADR-009). The exact
// text the Code/Values panels' copy-to-clipboard button produces is also what
// the Analyze panel sends to agent-api, so the model reviews precisely what the
// user could have pasted. Extracted from TabExtras.tsx (which now imports it)
// so both paths stay identical.
import { getCode } from '../../../api/api'
import type { ApiAbi, Field } from '../../../api/types'
import type { BundleContractInput } from '../../../api/agent'
import { getProjectQueryOptions } from '../hooks/projectQuery'

export async function formatContractCode(
  project: string,
  address: string | undefined,
  _name?: string,
): Promise<string[]> {
  const chain = address?.split(':')[0]
  if (!address) return []
  const sources = (await getCode(project, address))?.sources ?? []
  const result: string[] = []
  for (const s of sources) {
    let header = `Flattened source code of ${s.name}`
    if (address) header += ` (${address})`
    if (chain) header += ` on chain ${chain}`
    result.push('\n' + header + ':')
    result.push('```')
    result.push(s.code)
    result.push('```')
  }
  return result
}

export interface ContractValues {
  address: string
  chain: string
  fields?: Field[]
}

export function formatContractValues(
  contract: ContractValues,
  blockNumber?: number,
): string[] {
  const chain = contract.chain
  if (contract.fields === undefined || contract.fields.length === 0) {
    return []
  }
  const result: string[] = []
  let header = 'Contract state from public functions and event handlers'
  if (blockNumber !== undefined && chain) {
    header += ` for block number ${blockNumber} on chain ${chain}`
  }
  if (contract.address) header += ` (${contract.address})`
  result.push('\n' + header + ':')
  result.push('```')
  for (const f of contract.fields) {
    result.push(`${f.name}: ${JSON.stringify(f.value)}`)
  }
  result.push('```')
  return result
}

export interface ContractAbi {
  address: string
  chain: string
  abis?: ApiAbi[]
}

export function formatContractAbi(contract: ContractAbi): string[] {
  const chain = contract.chain
  if (contract.abis === undefined || contract.abis.length === 0) {
    return []
  }
  const result: string[] = []
  let header = 'Contract ABI'
  if (contract.address) header += ` for ${contract.address}`
  if (chain) header += ` on chain ${chain}`
  result.push('\n' + header + ':')
  result.push('```')
  for (const a of contract.abis) {
    for (const e of a.entries) {
      let abi = e.value
      if (e.signature) {
        abi += ` //${e.signature}`
      } else if (e.value.startsWith('event') && e.topic) {
        abi += ` //${e.topic}`
      }
      result.push(abi)
    }
  }
  result.push('```')
  return result
}

/** Code-panel context for a set of node addresses (eth:0x… or plain 0x…). */
export async function buildCodeContext(
  project: string,
  addresses: readonly string[],
): Promise<string> {
  const projectData = await getProjectQueryOptions(project).queryFn()
  const message: string[] = []
  for (const chain of projectData.entries) {
    const contracts = [
      ...chain.initialContracts,
      ...chain.discoveredContracts,
    ].filter((c) => addresses.includes(c.address))
    for (const contract of contracts) {
      message.push(...(await formatContractCode(project, contract.address, contract.name)))
    }
  }
  return message.join('\n')
}

/** Values-panel context (state + ABI) for a set of node addresses. */
export async function buildValueContext(
  project: string,
  addresses: readonly string[],
): Promise<string> {
  const projectData = await getProjectQueryOptions(project).queryFn()
  const message: string[] = []
  for (const chain of projectData.entries) {
    const contracts = [
      ...chain.initialContracts,
      ...chain.discoveredContracts,
    ].filter((c) => addresses.includes(c.address))
    for (const contract of contracts) {
      const values = formatContractValues(contract, chain.blockNumbers[contract.chain])
      const abi = formatContractAbi(contract)
      message.push(...values, ...abi)
    }
  }
  return message.join('\n')
}

/** Resolve node addresses to their contract names (for the panel's target list). */
export async function resolveSelectedContracts(
  project: string,
  addresses: readonly string[],
): Promise<{ address: string; name?: string }[]> {
  const projectData = await getProjectQueryOptions(project).queryFn()
  const out: { address: string; name?: string }[] = []
  for (const chain of projectData.entries) {
    for (const contract of [
      ...chain.initialContracts,
      ...chain.discoveredContracts,
    ]) {
      if (!addresses.includes(contract.address)) continue
      out.push({ address: contract.address, name: contract.name })
    }
  }
  return out
}

/** Every verified contract in a project/incident, for ADR-012 autonomous
 * bundle preparation. Unverified nodes are skipped because no grounded bundle
 * can be produced for them. */
export async function buildAutonomousContracts(
  project: string,
): Promise<BundleContractInput[]> {
  const projectData = await getProjectQueryOptions(project).queryFn()
  const out: BundleContractInput[] = []
  for (const chain of projectData.entries) {
    for (const contract of [
      ...chain.initialContracts,
      ...chain.discoveredContracts,
    ]) {
      let codeContext: string
      try {
        codeContext = (
          await formatContractCode(project, contract.address, contract.name)
        ).join('\n')
      } catch {
        // Some explorer records are nominally verified but flatten to an empty
        // body (source hash e3b0…); l2b then has no .flat file. Keep autonomous
        // preparation useful for the rest of the incident instead of failing
        // the whole candidate set on one unavailable source.
        continue
      }
      if (!codeContext.trim()) continue
      const valueContext = [
        ...formatContractValues(contract, chain.blockNumbers[contract.chain]),
        ...formatContractAbi(contract),
      ].join('\n')
      out.push({
        address: contract.address,
        name: contract.name,
        codeContext,
        valueContext: valueContext || undefined,
      })
    }
  }
  return out
}

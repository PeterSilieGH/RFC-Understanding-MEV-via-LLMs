// DIVERGENCE(mev): navigation-stable bundle preparation. Jobs live at module
// scope instead of inside a docking panel, so changing DiscoUI workspaces only
// unsubscribes that panel; it never aborts the preparation HTTP stream.
import { create } from 'zustand'
import {
  type AgentEffort,
  type AgentModelRef,
  type ContractBundle,
  type ResearchKind,
  streamPrepareBundles,
} from '../../../api/agent'
import { buildAutonomousContractRefs } from '../utils/panelContext'
import { buildGasContext } from './traceTree'

export interface BundlePreparationInput {
  project: string
  txHash?: string
  kinds: ResearchKind[]
  model?: AgentModelRef
  effort?: AgentEffort
}

export interface BundlePreparationSnapshot {
  status: 'idle' | 'preparing' | 'prepared' | 'error'
  phase:
    | 'loading'
    | 'resolving'
    | 'queued'
    | 'cached'
    | 'analyzing'
    | 'complete'
  bundles: ContractBundle[]
  warnings: { address: string; message: string }[]
  error: string | null
  completed: number
  total: number
}

export const EMPTY_PREPARATION: BundlePreparationSnapshot = {
  status: 'idle',
  phase: 'loading',
  bundles: [],
  warnings: [],
  error: null,
  completed: 0,
  total: 0,
}

interface Store {
  jobs: Record<string, BundlePreparationSnapshot>
}

export const useBundlePreparationStore = create<Store>(() => ({ jobs: {} }))

const active = new Map<string, Promise<void>>()

export function bundlePreparationKey(input: BundlePreparationInput): string {
  const model = input.model
    ? `${input.model.provider}/${input.model.id}`
    : 'default'
  return [
    input.project,
    [...input.kinds].sort().join(','),
    model,
    input.effort ?? 'default',
  ].join('|')
}

export function ensureBundlePreparation(
  input: BundlePreparationInput,
  force = false,
): Promise<void> {
  const key = bundlePreparationKey(input)
  const running = active.get(key)
  if (running) return running
  const current = useBundlePreparationStore.getState().jobs[key]
  if (!force && current?.status === 'prepared') return Promise.resolve()

  const job = runPreparation(key, input, current)
  active.set(key, job)
  void job.finally(() => {
    if (active.get(key) === job) active.delete(key)
  })
  return job
}

async function runPreparation(
  key: string,
  input: BundlePreparationInput,
  previous: BundlePreparationSnapshot | undefined,
): Promise<void> {
  const byKey = new Map(
    (previous?.bundles ?? []).map((bundle) => [
      `${bundle.codehash}:${bundle.kind}`,
      bundle,
    ]),
  )
  update(key, {
    ...EMPTY_PREPARATION,
    status: 'preparing',
    bundles: [...byKey.values()],
  })

  let terminal = false
  let fatalError: string | null = null
  try {
    const [contracts, gas] = await Promise.all([
      buildAutonomousContractRefs(input.project),
      buildGasContext(input.txHash),
    ])
    if (contracts.length === 0) {
      throw new Error('No contracts are available for analysis')
    }
    update(key, { phase: 'resolving' })
    const stream = streamPrepareBundles({
      project: input.project,
      kinds: input.kinds,
      contracts,
      gas,
      model: input.model,
      effort: input.effort,
    })
    for await (const event of stream) {
      if (event.type === 'bundle') {
        byKey.set(`${event.bundle.codehash}:${event.bundle.kind}`, event.bundle)
        update(key, {
          bundles: [...byKey.values()],
          warnings: snapshot(key).warnings.filter(
            (warning) => !event.bundle.addresses.includes(warning.address),
          ),
        })
      } else if (event.type === 'warning') {
        update(key, {
          warnings: [
            ...snapshot(key).warnings.filter(
              (warning) => warning.address !== event.address,
            ),
            { address: event.address, message: event.message },
          ],
        })
      } else if (event.type === 'progress') {
        update(key, {
          phase:
            event.phase === 'resolved'
              ? 'resolving'
              : event.phase === 'completed'
                ? 'analyzing'
                : event.phase,
          completed: event.completed,
          total: event.total,
        })
      } else if (event.type === 'queued') {
        update(key, { phase: 'queued' })
      } else if (event.type === 'error') {
        fatalError = event.message
        update(key, { error: event.message })
      } else if (event.type === 'prepared') {
        terminal = true
      }
    }
    if (!terminal && !fatalError) {
      fatalError = 'Bundle preparation stream ended before completion'
    }
  } catch (err) {
    fatalError = (err as Error).message
  }

  update(key, {
    status: fatalError ? 'error' : 'prepared',
    phase: fatalError ? snapshot(key).phase : 'complete',
    error: fatalError,
  })
}

function snapshot(key: string): BundlePreparationSnapshot {
  return useBundlePreparationStore.getState().jobs[key] ?? EMPTY_PREPARATION
}

function update(key: string, patch: Partial<BundlePreparationSnapshot>): void {
  useBundlePreparationStore.setState((state) => ({
    jobs: {
      ...state.jobs,
      [key]: { ...(state.jobs[key] ?? EMPTY_PREPARATION), ...patch },
    },
  }))
}

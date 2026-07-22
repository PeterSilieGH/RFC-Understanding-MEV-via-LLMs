// DIVERGENCE(mev): navigation-stable Discovery catalog store (ADR-016 §3/E7).
// Opening Discovery is a catalog/cache lookup only — no eager contract-ref
// build, no model turn, no decompilation. Jobs live at module scope so changing
// DiscoUI workspaces only unsubscribes a panel; it never aborts the HTTP stream.
import { create } from 'zustand'
import {
  type ContractBundle,
  type ContractCandidate,
  type IncidentSnapshot,
  type ResearchKind,
  streamPrepareBundles,
} from '../../../api/agent'

export interface BundlePreparationInput {
  project: string
  kinds: ResearchKind[]
}

/** An unresolved catalog candidate, tagged with the research kind it is
 * unresolved for (the same contract may be cached for one kind and unresolved
 * for another). */
export interface PreparedCandidate extends ContractCandidate {
  kind: ResearchKind
}

export interface BundlePreparationSnapshot {
  status: 'idle' | 'preparing' | 'prepared' | 'error'
  phase: 'loading' | 'resolving' | 'complete'
  fingerprint: string | null
  snapshot: IncidentSnapshot | null
  bundles: ContractBundle[]
  candidates: PreparedCandidate[]
  warnings: { address: string; message: string }[]
  error: string | null
  completed: number
  total: number
}

export const EMPTY_PREPARATION: BundlePreparationSnapshot = {
  status: 'idle',
  phase: 'loading',
  fingerprint: null,
  snapshot: null,
  bundles: [],
  candidates: [],
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
  return [input.project, [...input.kinds].sort().join(',')].join('|')
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
  const byBundle = new Map(
    (previous?.bundles ?? []).map((bundle) => [
      `${bundle.codehash}:${bundle.kind}`,
      bundle,
    ]),
  )
  const byCandidate = new Map<string, PreparedCandidate>()
  update(key, {
    ...EMPTY_PREPARATION,
    status: 'preparing',
    phase: 'resolving',
    bundles: [...byBundle.values()],
  })

  let terminal = false
  let fatalError: string | null = null
  try {
    const stream = streamPrepareBundles({ project: input.project, kinds: input.kinds })
    for await (const event of stream) {
      if (event.type === 'catalog') {
        update(key, { fingerprint: event.fingerprint, snapshot: event.snapshot })
      } else if (event.type === 'bundle') {
        byBundle.set(`${event.bundle.codehash}:${event.bundle.kind}`, event.bundle)
        // A now-cached contract is no longer an unresolved candidate.
        if (event.candidateId) {
          for (const kind of input.kinds) byCandidate.delete(`${event.candidateId}:${kind}`)
        }
        update(key, {
          bundles: [...byBundle.values()],
          candidates: [...byCandidate.values()],
          warnings: snapshot(key).warnings.filter(
            (warning) => !event.bundle.addresses.includes(warning.address),
          ),
        })
      } else if (event.type === 'candidate') {
        byCandidate.set(`${event.candidate.id}:${event.kind}`, {
          ...event.candidate,
          kind: event.kind,
        })
        update(key, { candidates: [...byCandidate.values()] })
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
        update(key, { completed: event.completed, total: event.total })
      } else if (event.type === 'error') {
        fatalError = event.message
        update(key, { error: event.message })
      } else if (event.type === 'prepared') {
        terminal = true
      }
    }
    if (!terminal && !fatalError) {
      fatalError = 'Catalog lookup ended before completion'
    }
  } catch (err) {
    fatalError = (err as Error).message
  }

  update(key, {
    status: fatalError ? 'error' : 'prepared',
    phase: 'complete',
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

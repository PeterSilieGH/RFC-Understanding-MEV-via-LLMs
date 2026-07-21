// DIVERGENCE(mev): ADR-012 research modes. Both are opt-in and persisted
// independently of docking layouts.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ResearchKind } from '../../../api/agent'

interface State {
  mev: boolean
  vuln: boolean
  toggle: (kind: ResearchKind) => void
}

export const useResearchStore = create<State>()(
  persist(
    (set) => ({
      mev: false,
      vuln: false,
      toggle: (kind) =>
        set((state) => ({ ...state, [kind]: !state[kind] })),
    }),
    // New key intentionally discards the former MEV-on default for existing
    // browsers as well as fresh profiles.
    { name: 'research-modes-v2' },
  ),
)

export function activeResearchKinds(state: Pick<State, 'mev' | 'vuln'>): ResearchKind[] {
  return [state.mev ? 'mev' : undefined, state.vuln ? 'vuln' : undefined].filter(
    (kind): kind is ResearchKind => kind !== undefined,
  )
}

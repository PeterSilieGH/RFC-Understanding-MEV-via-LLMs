// DIVERGENCE(mev): new file (ADR-009). The model chosen in the top-bar picker,
// persisted across reloads. `undefined` means "use the agent-api settings
// default" (project .pi/settings.json over global); the picker seeds it from
// that default once models load. Analyze / verdict runs pass the selection as
// the request `model`.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AgentModelRef } from '../../../api/agent'

interface State {
  selected: AgentModelRef | undefined
  setSelected: (model: AgentModelRef | undefined) => void
}

export const useAgentModelStore = create<State>()(
  persist(
    (set) => ({
      selected: undefined,
      setSelected: (selected) => set({ selected }),
    }),
    { name: 'agent-model-selection-v1' },
  ),
)

export function modelKey(model: AgentModelRef): string {
  return `${model.provider}/${model.id}`
}

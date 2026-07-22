// DIVERGENCE(mev): new file (ADR-009; split in the settings amendment). Two
// independently-chosen agent models and effort levels, persisted across reloads
// and edited in Global app settings: Analyze drives contract/bundle analysis;
// Discover drives verdicts and follow-up chat. `undefined` model means "use the
// agent-api settings default" (project .pi/settings.json over global); each
// picker seeds its field from that default once models load. Runs pass the
// relevant selections as request `model` / `effort`.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AgentEffort, AgentModelRef } from '../../../api/agent'

interface State {
  analyzeModel: AgentModelRef | undefined
  discoverModel: AgentModelRef | undefined
  analyzeEffort: AgentEffort | undefined
  discoverEffort: AgentEffort | undefined
  setAnalyzeModel: (model: AgentModelRef | undefined) => void
  setDiscoverModel: (model: AgentModelRef | undefined) => void
  setAnalyzeEffort: (effort: AgentEffort | undefined) => void
  setDiscoverEffort: (effort: AgentEffort | undefined) => void
}

export const useAgentModelStore = create<State>()(
  persist(
    (set) => ({
      analyzeModel: undefined,
      discoverModel: undefined,
      analyzeEffort: undefined,
      discoverEffort: 'low',
      setAnalyzeModel: (analyzeModel) => set({ analyzeModel }),
      setDiscoverModel: (discoverModel) => set({ discoverModel }),
      setAnalyzeEffort: (analyzeEffort) => set({ analyzeEffort }),
      setDiscoverEffort: (discoverEffort) => set({ discoverEffort }),
    }),
    {
      name: 'agent-model-selection-v2',
      version: 1,
      migrate: (persisted) => {
        const old = persisted as Partial<State> & {
          incidentModel?: AgentModelRef
        }
        return {
          ...old,
          discoverModel: old.discoverModel ?? old.incidentModel,
          discoverEffort: old.discoverEffort ?? 'low',
        } as State
      },
    },
  ),
)

export function modelKey(model: AgentModelRef): string {
  return `${model.provider}/${model.id}`
}

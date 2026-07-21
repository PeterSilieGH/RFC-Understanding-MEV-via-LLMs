// DIVERGENCE(mev): new file (ADR-009; split in the settings amendment). Two
// independently-chosen agent models, persisted across reloads and now edited in
// Global app settings rather than the top bar: `analyzeModel` drives the
// Analyze panel (code/value review), `incidentModel` drives Incident reporting
// (build-preview verdict + its follow-up chat). `undefined` means "use the
// agent-api settings default" (project .pi/settings.json over global); each
// picker seeds its field from that default once models load. Runs pass the
// relevant selection as the request `model`.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AgentModelRef } from '../../../api/agent'

interface State {
  analyzeModel: AgentModelRef | undefined
  incidentModel: AgentModelRef | undefined
  setAnalyzeModel: (model: AgentModelRef | undefined) => void
  setIncidentModel: (model: AgentModelRef | undefined) => void
}

export const useAgentModelStore = create<State>()(
  persist(
    (set) => ({
      analyzeModel: undefined,
      incidentModel: undefined,
      setAnalyzeModel: (analyzeModel) => set({ analyzeModel }),
      setIncidentModel: (incidentModel) => set({ incidentModel }),
    }),
    { name: 'agent-model-selection-v2' },
  ),
)

export function modelKey(model: AgentModelRef): string {
  return `${model.provider}/${model.id}`
}

// DIVERGENCE(mev): new file. Tiny cross-panel channel for the trace
// workspace (ADR-008): the List panel asks the graph (nodes panel) to show a
// specific call node of a specific leg; the graph switches transactions when
// needed and selects/focuses the node once loaded.
import { create } from 'zustand'

export interface TraceFocusRequest {
  txHash: string
  nodeId: string
  /** monotonically increasing, so re-clicking the same entry re-focuses */
  seq: number
}

interface TraceWorkspaceState {
  focusRequest: TraceFocusRequest | undefined
  requestFocus: (txHash: string, nodeId: string) => void
  /** the transaction whose graph the nodes panel currently shows - the
   * docked trace details panel joins the selection onto its MEV facts */
  activeTxHash: string | undefined
  setActiveTxHash: (txHash: string | undefined) => void
}

export const useTraceWorkspaceStore = create<TraceWorkspaceState>()((set, get) => ({
  focusRequest: undefined,
  requestFocus: (txHash, nodeId) =>
    set({
      focusRequest: { txHash, nodeId, seq: (get().focusRequest?.seq ?? 0) + 1 },
    }),
  activeTxHash: undefined,
  setActiveTxHash: (txHash) => set({ activeTxHash: txHash }),
}))

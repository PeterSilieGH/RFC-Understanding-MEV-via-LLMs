// DIVERGENCE(mev): new file. The Analyze panel, trace-aware (ADR-008 T8):
// in the trace workspace the tab is registered but disabled - agentic
// incident analysis via the pi harness is M5's first UI task (ADR-006).
// In a discovery project the stock AnalyzePanel renders.
import { useParams } from 'react-router-dom'
import { AnalyzePanel } from '../panel-analyze/AnalyzePanel'

export function AnalyzeTracePanel() {
  const { txHash } = useParams()
  if (!txHash) {
    return <AnalyzePanel />
  }
  return (
    <div className="flex h-full select-none flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="font-bold text-coffee-200 text-sm uppercase">
        Incident analysis is not wired up yet
      </p>
      <p className="max-w-96 text-coffee-400 text-xs leading-relaxed">
        Agentic analysis of MEV incidents (pi harness over the trace
        workspace) lands with M5 — see ADR-006 and ADR-008. Until then, use
        the Values / Code panels on the discovered contracts of this
        incident.
      </p>
    </div>
  )
}

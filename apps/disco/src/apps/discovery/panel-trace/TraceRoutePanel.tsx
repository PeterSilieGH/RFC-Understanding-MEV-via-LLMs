// DIVERGENCE(mev): new file. Docked form of the trace panel: picks up the
// deep-linked tx hash from the route (trace workspace, ADR-008) and falls
// back to manual input inside a discovery project.
import { useParams } from 'react-router-dom'
import { TracePanel } from './TracePanel'

export function TraceRoutePanel() {
  const { txHash } = useParams()
  return <TracePanel key={txHash ?? ''} initialTxHash={txHash} />
}

// DIVERGENCE(mev): new file. The nodes panel, trace-aware (ADR-008): in the
// trace workspace (a :txHash route param is present) "nodes" IS the
// execution-trace graph; in a discovery project it stays the dependency
// graph. One panel id, no separate trace tab.
import { useParams } from 'react-router-dom'
import { NodesPanel } from '../panel-nodes/NodesPanel'
import { TracePanel } from './TracePanel'

export function NodesTracePanel() {
  const { txHash } = useParams()
  if (txHash) {
    return <TracePanel key={txHash} initialTxHash={txHash} />
  }
  return <NodesPanel />
}

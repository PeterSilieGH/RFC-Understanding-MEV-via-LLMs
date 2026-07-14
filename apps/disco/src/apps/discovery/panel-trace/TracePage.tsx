// DIVERGENCE(mev): new file. Standalone full-screen trace view (M4) so the
// MEV explorer can deep-link a transaction (/ui/trace/:txHash) without
// needing a discovery project context.
import { useParams } from 'react-router-dom'
import { Title } from '../../../components/Title'
import { TracePanel } from './TracePanel'

export function TracePage() {
  const { txHash } = useParams()
  return (
    <>
      <Title title="DiscoUI - trace" />
      <div className="h-screen w-screen">
        {/* remount when the deep-linked hash changes */}
        <TracePanel key={txHash ?? ''} initialTxHash={txHash} />
      </div>
    </>
  )
}

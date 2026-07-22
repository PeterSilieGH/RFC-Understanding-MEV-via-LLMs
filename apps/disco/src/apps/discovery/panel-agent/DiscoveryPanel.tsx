// DIVERGENCE(mev): ADR-013 §2 splits the agentic Discovery surfaces out of the
// stock preview into their own docking panel (id `preview`, label "Discovery").
// The permissions/contracts artifact now lives in the separate `contracts`
// ("Preview") panel.
import { useParams } from 'react-router-dom'
import { DiscoveryPanes } from './DiscoveryPanes'

export function DiscoveryPanel() {
  const { project } = useParams()
  if (!project) {
    throw new Error('Cannot use component outside of project page!')
  }
  return (
    <div className="h-full w-full overflow-auto">
      <DiscoveryPanes project={project} />
    </div>
  )
}
